import { randomUUID } from "node:crypto";

// GetCommandInvocation returns only this much of what a command prints.
const standardOutputCharacters = 24_000;
const standardErrorCharacters = 8_000;
const failed = new Set(["Failed", "TimedOut", "Cancelled"]);
// The environment file on each host holds the cursor key. The release command
// never prints it, which scripts/ec2-release-command.test.mjs checks for every
// case it runs. The job log is public and cannot be edited afterwards, so a
// line that names the key is not passed on, whatever a later command prints.
const withheld = "EACL_CURSOR_KEY";

// Returns the `whileWaiting` function for smokeFunctionUrl that lets an EC2
// release fail as soon as its host command has failed, with what the command
// printed in the job log, instead of waiting out the public origin.
//
// `readInvocation` answers `{ invocation }` with a GetCommandInvocation
// result, `{ denied: true }` when the job's role may not read it, or
// `{ unavailable: reason }` for anything else, such as the seconds after
// SendCommand in which SSM does not know the invocation yet.
//
// Only a command that has ended in failure ends the wait. A command that
// succeeded has still to show at the public origin. A denied read is not
// repeated, so a role without the permission waits exactly as it did before,
// and a read that fails for any other reason is tried again and never fails
// the deployment by itself. The command's status is logged when it is first
// read and when it changes, which also shows that the role may read it.
//
// A read runs beside the wait and its answer is acted on the next time the
// wait asks, so a slow or hanging read cannot hold up the polling of the
// origin. Only the last ask, when the time is up, waits for a read.
export function releaseCommandWatch({
  label,
  readInvocation,
  write,
  workflowCommands = false,
  intervalMs = 5_000,
  now = () => performance.now(),
  endToken = randomUUID
}) {
  let settled = false;
  let readAgainAt = Number.NEGATIVE_INFINITY;
  let reading = null;
  let answered = null;
  let logged = null;
  const read = () => {
    readAgainAt = now() + intervalMs;
    reading = (async () => readInvocation())()
      .catch((error) => ({ unavailable: error instanceof Error ? error.message : String(error) }))
      .then((answer) => {
        answered = { answer };
        reading = null;
      });
    return reading;
  };
  const act = async (final) => {
    const { answer } = answered;
    answered = null;
    if (answer?.denied === true) {
      settled = true;
      await write(`${label}: this job's role may not read the command's result (ssm:GetCommandInvocation), so only the public origin is checked\n`);
      return;
    }
    const invocation = answer?.invocation;
    const status = invocation?.Status;
    if (typeof status !== "string") {
      if (final) await write(`${label}: its result could not be read (${answer?.unavailable ?? "unexpected answer"})\n`);
      return;
    }
    if (status === "Success") {
      settled = true;
      await write(`${label} succeeded on its host\n`);
      return;
    }
    if (!failed.has(status)) {
      if (final) await write(`${label} was still ${status} when the wait ended\n`);
      else if (status !== logged) await write(`${label} is ${status}\n`);
      logged = status;
      return;
    }
    settled = true;
    const outcome = `${status}${details(invocation)}, ${exitCode(invocation)}`;
    // What a host prints must not be read as workflow commands. The runner
    // looks for them in every line of a step's output and takes none between
    // these two lines, whose token the host cannot know.
    const token = workflowCommands ? endToken() : null;
    await write([
      `${label} ended on its host: ${outcome}\n`,
      token === null ? "" : `::stop-commands::${token}\n`,
      section("standard output", invocation.StandardOutputContent, standardOutputCharacters),
      section("standard error", invocation.StandardErrorContent, standardErrorCharacters),
      token === null ? "" : `::${token}::\n`
    ].join(""));
    throw new Error(`${label} failed on its host: ${outcome}`);
  };
  return async ({ final }) => {
    if (!settled && answered !== null) await act(false);
    if (settled) return;
    if (!final) {
      if (reading === null && now() >= readAgainAt) read();
      return;
    }
    await (reading ?? read());
    await act(true);
  };
}

function details({ Status, StatusDetails }) {
  return typeof StatusDetails === "string" && StatusDetails !== Status && /^[A-Za-z]+(?: [A-Za-z]+)*$/u.test(StatusDetails)
    ? ` (${StatusDetails})`
    : "";
}

// SSM reports -1 for a command that never started on the host.
function exitCode({ ResponseCode }) {
  return Number.isInteger(ResponseCode) && ResponseCode >= 0 ? `exit code ${ResponseCode}` : "no exit code";
}

function section(title, content, limit) {
  const text = typeof content === "string" ? content : "";
  const cut = text.length >= limit ? ` (the first ${limit.toLocaleString("en-US")} characters, which is all that SSM returns)` : "";
  const lines = text === ""
    ? ["(nothing)"]
    : text.replace(/\n$/u, "").split("\n")
      .map((line) => line.includes(withheld) ? `[a line that names ${withheld} is withheld]` : line);
  return `${title}${cut}:\n${lines.join("\n")}\n`;
}
