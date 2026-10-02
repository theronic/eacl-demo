import assert from "node:assert/strict";
import nodeTest from "node:test";
import { smokeFunctionUrl } from "./lib/public-readiness.mjs";
import { releaseCommandWatch } from "./lib/release-command-result.mjs";

// These waits run on a clock that only the wait itself moves, so a watch that
// held the wait up would never return. The limit turns that into a failure.
const test = (name, run) => nodeTest(name, { timeout: 60_000 }, run);

const identity = {
  profileId: "datalevin-memory",
  demoSha: "a".repeat(40),
  eaclSha: "b".repeat(40),
  artifactSha256: "c".repeat(64),
  deploymentId: "production:release-test"
};
// What the origin serves before a release and again after a restore.
const previous = {
  ...identity, demoSha: "9".repeat(40), artifactSha256: "8".repeat(64), deploymentId: "production:previous"
};
const label = "datalevin-memory-ec2 command 0f1e2d3c-4b5a-4697-8877-665544332211";
const denied = `${label}: this job's role may not read the command's result (ssm:GetCommandInvocation), so only the public origin is checked\n`;

const invocation = (fields) => ({ invocation: {
  CommandId: "0f1e2d3c-4b5a-4697-8877-665544332211",
  InstanceId: "i-0123456789abcdef0",
  DocumentName: "AWS-RunShellScript",
  PluginName: "aws:runShellScript",
  StandardOutputUrl: "",
  StandardErrorUrl: "",
  ...fields
} });
const status = (name) => invocation({
  Status: name, StatusDetails: name, ResponseCode: -1, StandardOutputContent: "", StandardErrorContent: ""
});
const succeeded = invocation({
  Status: "Success", StatusDetails: "Success", ResponseCode: 0,
  StandardOutputContent: "/opt/eacl-demo/datalevin.jar.next: OK\n", StandardErrorContent: ""
});
const restored = invocation({
  Status: "Failed", StatusDetails: "Failed", ResponseCode: 1,
  StandardOutputContent: [
    "The new release did not become healthy.",
    "● eacl-demo-datalevin.service - EACL read-only Datalevin embedded demo",
    "     Active: activating (auto-restart) (Result: exit-code)",
    "Last lines of /var/log/eacl-demo/datalevin.log:",
    "Execution error (ExceptionInfo) :datalevin/frozen-attribute-write",
    `Restoring artifact ${previous.artifactSha256}.`,
    "The previous release is restored and healthy.",
    ""
  ].join("\n"),
  StandardErrorContent: "failed to run commands: exit status 1"
});

function served(body) {
  return new Response(JSON.stringify({
    data: { ready: true, identity: body },
    meta: { revision: "datalevin:17", requestId: "release-test" }
  }), { headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "https://demo.eacl.dev"
  } });
}

// A read that answers only after this many seconds of the wait have passed.
const taking = (seconds, answer) => ({ taking: seconds, answer });

// One release as the job sees it. `origin` and `ssm` say what the public
// origin serves and what reading the command's result answers at a given
// second of the wait. Only the wait's own sleeps move the clock, and a job
// without `ssm` waits the way it did before it read the result at all.
async function job({ origin, ssm = null, timeoutMs = 900_000, ...watch }) {
  let elapsed = 0;
  const now = () => elapsed;
  const reads = [];
  const written = [];
  let attempts = 0;
  let inFlight = [];
  let timeIsUp = false;
  // A read in flight answers once its time has passed, and at the latest
  // when the wait's last ask is waiting for it.
  const answerReads = () => {
    const due = inFlight.filter(({ at }) => timeIsUp || at <= elapsed);
    inFlight = inFlight.filter((read) => !due.includes(read));
    for (const { answer } of due) answer();
  };
  const asked = ssm === null ? null : releaseCommandWatch({
    label,
    now,
    readInvocation: () => {
      reads.push(elapsed / 1_000);
      const answer = ssm(elapsed / 1_000);
      if (answer?.taking === undefined) return Promise.resolve(answer);
      return new Promise((resolve) => {
        inFlight.push({ at: elapsed + answer.taking * 1_000, answer: () => resolve(answer.answer) });
        answerReads();
      });
    },
    write: async (text) => { written.push(text); },
    ...watch
  });
  const whileWaiting = asked === null ? {} : { whileWaiting: (state) => {
    if (state.final) {
      timeIsUp = true;
      answerReads();
    }
    return asked(state);
  } };
  let failure = null;
  try {
    await smokeFunctionUrl(identity.profileId, "https://datalevin.demo.eacl.dev", identity, {
      now,
      sleep: async (ms) => {
        elapsed += ms;
        answerReads();
      },
      timeoutMs,
      fetchResponse: async () => {
        attempts += 1;
        return served(origin(elapsed / 1_000));
      },
      ...whileWaiting
    });
  } catch (error) {
    failure = error;
  }
  return { failure, seconds: elapsed / 1_000, reads, written: written.join(""), attempts };
}

test("a role that may not read the result is told once and then waits exactly as before", async () => {
  for (const origin of [() => previous, (second) => (second < 40 ? previous : identity)]) {
    const before = await job({ origin });
    const after = await job({ origin, ssm: () => ({ denied: true }) });
    assert.equal(after.failure?.message, before.failure?.message);
    assert.equal(after.seconds, before.seconds);
    assert.equal(after.attempts, before.attempts);
    assert.deepEqual(after.reads, [0]);
    assert.equal(after.written, denied);
  }
  const never = await job({ origin: () => previous, ssm: () => ({ denied: true }) });
  assert.equal(never.seconds, 900);
  assert.match(never.failure.message,
    /^datalevin-memory public origin smoke failed after deployment propagation: \{"status":200,"contentType":"application\/json","identity":\{/u);
  assert.ok(never.failure.message.includes(previous.artifactSha256));
});

test("a failed command ends the wait at the next read, with what it printed in the job log", async () => {
  const result = await job({ origin: () => previous, ssm: (second) => (second < 371 ? status("InProgress") : restored) });
  assert.equal(result.failure.message, `${label} failed on its host: Failed, exit code 1`);
  // Read at 372 s, and acted on at the wait's next ask.
  assert.equal(result.seconds, 374);
  assert.equal(result.written, [
    `${label} is InProgress`,
    `${label} ended on its host: Failed, exit code 1`,
    "standard output:",
    "The new release did not become healthy.",
    "● eacl-demo-datalevin.service - EACL read-only Datalevin embedded demo",
    "     Active: activating (auto-restart) (Result: exit-code)",
    "Last lines of /var/log/eacl-demo/datalevin.log:",
    "Execution error (ExceptionInfo) :datalevin/frozen-attribute-write",
    `Restoring artifact ${previous.artifactSha256}.`,
    "The previous release is restored and healthy.",
    "standard error:",
    "failed to run commands: exit status 1",
    ""
  ].join("\n"));
  // The result is read while the origin is polled, and no more often than every 5 s.
  assert.equal(result.reads[0], 0);
  assert.ok(result.reads.length > 60);
  for (let index = 1; index < result.reads.length; index += 1) {
    const gap = result.reads[index] - result.reads[index - 1];
    assert.ok(gap >= 5 && gap <= 7, `read again after ${gap} s`);
  }
});

test("a command that failed before it could print anything is still reported", async () => {
  const result = await job({ origin: () => previous, ssm: () => invocation({
    Status: "Failed", StatusDetails: "Failed", ResponseCode: 2, StandardOutputContent: "", StandardErrorContent: ""
  }) });
  // The read is started at the first ask and acted on at the next.
  assert.equal(result.seconds, 2);
  assert.equal(result.failure.message, `${label} failed on its host: Failed, exit code 2`);
  assert.equal(result.written,
    `${label} ended on its host: Failed, exit code 2\nstandard output:\n(nothing)\nstandard error:\n(nothing)\n`);
});

test("the wait goes on, or ends, only after what was written has been written out", async () => {
  for (const [answer, ends] of [[restored, /failed on its host/u], [succeeded, null], [{ denied: true }, null]]) {
    const events = [];
    const watch = releaseCommandWatch({
      label,
      now: () => 0,
      readInvocation: async () => answer,
      write: () => new Promise((resolve) => {
        setImmediate(() => {
          events.push("written out");
          resolve();
        });
      })
    });
    // The first ask starts the read, and an ask after the read has answered
    // acts on the answer.
    await watch({ final: false });
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.deepEqual(events, []);
    const asked = watch({ final: false }).finally(() => events.push("answered"));
    if (ends === null) await asked;
    else await assert.rejects(asked, ends);
    assert.deepEqual(events, ["written out", "answered"]);
  }
});

test("the public origin alone decides success", async () => {
  // The command succeeds on the host and the origin follows.
  const followed = await job({
    origin: (second) => (second < 40 ? previous : identity),
    ssm: (second) => (second < 30 ? status("InProgress") : succeeded)
  });
  assert.equal(followed.failure, null);
  assert.equal(followed.seconds, 40);
  assert.equal(followed.written, `${label} is InProgress\n${label} succeeded on its host\n`);
  assert.deepEqual(followed.reads, [0, 6, 12, 18, 24, 30]);

  // The command succeeds and the origin never shows the release.
  const unseen = await job({ origin: () => previous, ssm: () => succeeded });
  assert.equal(unseen.seconds, 900);
  assert.match(unseen.failure.message, /^datalevin-memory public origin smoke failed after deployment propagation: /u);
  assert.equal(unseen.written, `${label} succeeded on its host\n`);
  assert.deepEqual(unseen.reads, [0]);

  // The origin shows the release while the command is still running, and
  // even though the command has already failed.
  for (const ssm of [() => status("InProgress"), (second) => (second < 6 ? status("InProgress") : restored)]) {
    const shown = await job({ origin: (second) => (second < 6 ? previous : identity), ssm });
    assert.equal(shown.failure, null);
    assert.equal(shown.seconds, 6);
    assert.equal(shown.written, `${label} is InProgress\n`);
  }
});

test("the command's status is logged when it is first read and when it changes", async () => {
  const result = await job({ origin: (second) => (second < 60 ? previous : identity), ssm: (second) => (
    second < 6 ? { unavailable: "InvocationDoesNotExist" }
      : second < 12 ? status("Pending")
        : second < 24 ? status("Delayed")
          : second < 48 ? status("InProgress")
            : succeeded
  ) });
  assert.equal(result.failure, null);
  assert.equal(result.seconds, 60);
  assert.equal(result.written, [
    `${label} is Pending`,
    `${label} is Delayed`,
    `${label} is InProgress`,
    `${label} succeeded on its host`,
    ""
  ].join("\n"));
  assert.deepEqual(result.reads, [0, 6, 12, 18, 24, 30, 36, 42, 48]);
});

test("a timed-out or cancelled command ends the wait like a failed one", async () => {
  for (const [name, statusDetails, responseCode, outcome] of [
    ["TimedOut", "ExecutionTimedOut", 143, "TimedOut (ExecutionTimedOut), exit code 143"],
    ["TimedOut", "DeliveryTimedOut", -1, "TimedOut (DeliveryTimedOut), no exit code"],
    ["Cancelled", "Cancelled", -1, "Cancelled, no exit code"],
    ["Failed", "::error::not a status", 1, "Failed, exit code 1"]
  ]) {
    const result = await job({ origin: () => previous, ssm: (second) => (second < 60 ? status("InProgress") : invocation({
      Status: name, StatusDetails: statusDetails, ResponseCode: responseCode,
      StandardOutputContent: "", StandardErrorContent: ""
    })) });
    assert.equal(result.failure.message, `${label} failed on its host: ${outcome}`);
    assert.equal(result.seconds, 62);
    assert.ok(result.written.startsWith(`${label} is InProgress\n${label} ended on its host: ${outcome}\n`));
  }
});

test("a command that has not ended does not end the wait, and is named when the time is up", async () => {
  for (const name of ["Pending", "InProgress", "Delayed", "Cancelling", "SomeLaterStatus"]) {
    const result = await job({ origin: () => previous, ssm: () => status(name) });
    assert.equal(result.seconds, 900);
    assert.match(result.failure.message, /^datalevin-memory public origin smoke failed after deployment propagation: /u);
    assert.equal(result.written, `${label} is ${name}\n${label} was still ${name} when the wait ended\n`);
  }
});

test("a read that is slow or never answers does not hold up the polling of the origin", async () => {
  const hanging = () => taking(20, { unavailable: "no answer from the AWS CLI" });
  // The release shows at the origin after 40 s, exactly when it would have
  // without any read, and only one read is in flight at a time.
  const before = await job({ origin: (second) => (second < 40 ? previous : identity) });
  const shown = await job({ origin: (second) => (second < 40 ? previous : identity), ssm: hanging });
  assert.equal(shown.failure, null);
  assert.equal(shown.seconds, 40);
  assert.equal(shown.seconds, before.seconds);
  assert.equal(shown.attempts, before.attempts);
  assert.deepEqual(shown.reads, [0, 20]);

  // The release never shows: the origin is polled as often as without any
  // read, and the last ask waits for the read that is in flight.
  const never = await job({ origin: () => previous });
  const unseen = await job({ origin: () => previous, ssm: () => taking(3_600, status("InProgress")) });
  assert.equal(unseen.seconds, 900);
  assert.equal(unseen.failure.message, never.failure.message);
  assert.equal(unseen.attempts, never.attempts);
  assert.deepEqual(unseen.reads, [0]);
  assert.equal(unseen.written, `${label} was still InProgress when the wait ended\n`);

  // A slow read still gets a failed command reported, a little later.
  const slow = await job({
    origin: () => previous, ssm: (second) => taking(3, second < 100 ? status("InProgress") : restored)
  });
  assert.equal(slow.failure.message, `${label} failed on its host: Failed, exit code 1`);
  assert.equal(slow.seconds, 106);
  assert.deepEqual(slow.reads.slice(0, 4), [0, 6, 12, 18]);
});

test("a command that fails in the last seconds of the wait is still reported", async () => {
  const result = await job({ origin: () => previous, ssm: (second) => (second < 897 ? status("InProgress") : restored) });
  assert.equal(result.seconds, 900);
  assert.equal(result.failure.message, `${label} failed on its host: Failed, exit code 1`);
  assert.ok(result.written.includes("The previous release is restored and healthy."));
  assert.deepEqual(result.reads.slice(-2), [894, 900]);

  // The time is up less than 5 s after the last read: the result is read
  // once more all the same.
  const sooner = await job({
    origin: () => previous, timeoutMs: 898_000, ssm: (second) => (second < 895 ? status("InProgress") : restored)
  });
  assert.equal(sooner.seconds, 898);
  assert.equal(sooner.failure.message, `${label} failed on its host: Failed, exit code 1`);
  assert.deepEqual(sooner.reads.slice(-2), [894, 898]);
});

test("a result that cannot be read is read again and never fails the deployment by itself", async () => {
  // SSM does not know the invocation in the first seconds after SendCommand.
  const late = await job({ origin: () => previous, ssm: (second) => (
    second < 10 ? { unavailable: "InvocationDoesNotExist" } : second < 100 ? status("InProgress") : restored
  ) });
  assert.equal(late.failure.message, `${label} failed on its host: Failed, exit code 1`);
  assert.equal(late.seconds, 104);
  assert.ok(!late.written.includes("could not be read"));

  for (const [ssm, reason] of [
    [() => ({ unavailable: "ThrottlingException" }), "ThrottlingException"],
    [() => { throw new Error("spawn aws ENOENT"); }, "spawn aws ENOENT"],
    [() => ({ invocation: { CommandId: "without a status" } }), "unexpected answer"],
    [() => null, "unexpected answer"]
  ]) {
    const before = await job({ origin: (second) => (second < 40 ? previous : identity) });
    const shown = await job({ origin: (second) => (second < 40 ? previous : identity), ssm });
    assert.equal(shown.failure, null);
    assert.equal(shown.seconds, before.seconds);
    assert.equal(shown.written, "");

    const never = await job({ origin: () => previous, ssm });
    assert.equal(never.seconds, 900);
    assert.match(never.failure.message, /^datalevin-memory public origin smoke failed after deployment propagation: /u);
    assert.equal(never.written, `${label}: its result could not be read (${reason})\n`);
    assert.equal(never.reads.length, 151);
  }
});

test("what the host printed cannot issue workflow commands in the job log", async () => {
  const hostile = invocation({
    Status: "Failed", StatusDetails: "Failed", ResponseCode: 1,
    StandardOutputContent: "::add-mask::sent\n  ::error::forged\nlog line ##[error]forged\n::stop-commands::guess\n::guess::\n::end-1::\n",
    StandardErrorContent: "::set-output name=forged::1\n"
  });
  let tokens = 0;
  const result = await job({
    origin: () => previous, ssm: () => hostile, workflowCommands: true, endToken: () => `end-${tokens += 1}`
  });
  assert.equal(result.written, [
    `${label} ended on its host: Failed, exit code 1`,
    "::stop-commands::end-1",
    "standard output:",
    "::add-mask::sent",
    "  ::error::forged",
    "log line ##[error]forged",
    "::stop-commands::guess",
    "::guess::",
    "::end-1::",
    "standard error:",
    "::set-output name=forged::1",
    "::end-1::",
    ""
  ].join("\n"));

  // Outside a workflow run the two lines would only be noise.
  const local = await job({ origin: () => previous, ssm: () => hostile });
  assert.ok(!local.written.includes("::stop-commands::end") && local.written.includes("::add-mask::sent"));

  // The host cannot end the block early, because it cannot know the token:
  // each report draws a new random one.
  const drawn = [];
  for (let report = 0; report < 2; report += 1) {
    const { written } = await job({ origin: () => previous, ssm: () => restored, workflowCommands: true });
    const lines = written.split("\n");
    const token = /^::stop-commands::([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/u.exec(lines[1])?.[1];
    assert.ok(token, lines[1]);
    assert.deepEqual(lines.slice(-2), [`::${token}::`, ""]);
    assert.equal(lines.filter((line) => line.includes(token)).length, 2);
    drawn.push(token);
  }
  assert.notEqual(drawn[0], drawn[1]);
});

test("a line that names the cursor key is withheld from the job log", async () => {
  const key = "k".repeat(64);
  const result = await job({ origin: () => previous, ssm: () => invocation({
    Status: "Failed", StatusDetails: "Failed", ResponseCode: 1,
    StandardOutputContent: `before\nEACL_CURSOR_KEY=${key}\n{"EACL_CURSOR_KEY": "${key}", "EACL_DEMO_SHA": "${identity.demoSha}"}\nafter\n`,
    StandardErrorContent: `+ grep EACL_CURSOR_KEY=${key} /etc/eacl-demo-datalevin.env`
  }) });
  assert.equal(result.written, [
    `${label} ended on its host: Failed, exit code 1`,
    "standard output:",
    "before",
    "[a line that names EACL_CURSOR_KEY is withheld]",
    "[a line that names EACL_CURSOR_KEY is withheld]",
    "after",
    "standard error:",
    "[a line that names EACL_CURSOR_KEY is withheld]",
    ""
  ].join("\n"));
  assert.ok(!result.written.includes(key));
});

test("output that SSM has cut is marked as cut", async () => {
  const result = await job({ origin: () => previous, ssm: () => invocation({
    Status: "Failed", StatusDetails: "Failed", ResponseCode: 1,
    StandardOutputContent: `${"x".repeat(79)}\n`.repeat(300),
    StandardErrorContent: "y".repeat(8_000)
  }) });
  const lines = result.written.split("\n");
  assert.equal(lines[1], "standard output (the first 24,000 characters, which is all that SSM returns):");
  assert.equal(lines[302], "standard error (the first 8,000 characters, which is all that SSM returns):");
  assert.equal(lines.length, 305);

  const whole = await job({ origin: () => previous, ssm: () => invocation({
    Status: "Failed", StatusDetails: "Failed", ResponseCode: 1,
    StandardOutputContent: "x".repeat(23_999), StandardErrorContent: "y".repeat(7_999)
  }) });
  assert.deepEqual(whole.written.split("\n").filter((line) => line.startsWith("standard ")),
    ["standard output:", "standard error:"]);
});
