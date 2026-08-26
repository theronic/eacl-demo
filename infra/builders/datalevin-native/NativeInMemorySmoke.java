import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

import datalevin.dtlvnative.DTLV;
import org.bytedeco.javacpp.BytePointer;
import org.bytedeco.javacpp.IntPointer;
import org.bytedeco.javacpp.Loader;

public final class NativeInMemorySmoke {
    private static void requireSuccess(String operation, int result) {
        if (result != DTLV.MDB_SUCCESS) {
            throw new IllegalStateException(operation + " failed with LMDB result " + result);
        }
    }

    public static void main(String[] args) {
        Loader.load(DTLV.class);
        DTLV.MDB_env env = new DTLV.MDB_env();
        IntPointer dbi = new IntPointer(1);
        BytePointer key = null;
        IntPointer value = null;
        DTLV.MDB_txn readTxn = null;
        try {
            requireSuccess("mdb_env_create", DTLV.mdb_env_create(env));
            requireSuccess("mdb_env_set_maxdbs", DTLV.mdb_env_set_maxdbs(env, 1));
            requireSuccess(
                "mdb_env_open(MDB_INMEMORY)",
                DTLV.mdb_env_open(env, (String) null, DTLV.MDB_INMEMORY, 0664));

            DTLV.MDB_txn writeTxn = new DTLV.MDB_txn();
            requireSuccess("mdb_txn_begin(write)", DTLV.mdb_txn_begin(env, null, 0, writeTxn));
            requireSuccess("mdb_dbi_open", DTLV.mdb_dbi_open(writeTxn, "smoke", DTLV.MDB_CREATE, dbi));

            byte[] keyBytes = "native-in-memory".getBytes(StandardCharsets.UTF_8);
            key = new BytePointer(keyBytes.length);
            key.position(0).limit(keyBytes.length).asByteBuffer().put(keyBytes);
            DTLV.MDB_val keyValue = new DTLV.MDB_val()
                .mv_size(keyBytes.length)
                .mv_data(key);

            int expected = 42;
            value = new IntPointer(1);
            value.position(0).limit(1).asByteBuffer().putInt(expected);
            DTLV.MDB_val storedValue = new DTLV.MDB_val()
                .mv_size(Integer.BYTES)
                .mv_data(value);
            requireSuccess("mdb_put", DTLV.mdb_put(writeTxn, dbi.get(), keyValue, storedValue, 0));
            requireSuccess("mdb_txn_commit", DTLV.mdb_txn_commit(writeTxn));

            readTxn = new DTLV.MDB_txn();
            requireSuccess(
                "mdb_txn_begin(read)",
                DTLV.mdb_txn_begin(env, null, DTLV.MDB_RDONLY, readTxn));
            DTLV.MDB_val loadedValue = new DTLV.MDB_val();
            requireSuccess("mdb_get", DTLV.mdb_get(readTxn, dbi.get(), keyValue, loadedValue));
            ByteBuffer loaded = loadedValue.mv_data().limit(loadedValue.mv_size()).asByteBuffer();
            int actual = loaded.getInt();
            if (actual != expected) {
                throw new IllegalStateException("round trip returned " + actual + " instead of " + expected);
            }

            System.out.println("{\"nativeLoaded\":true,\"storageMode\":\"MDB_INMEMORY\",\"roundTrip\":true}");
        } finally {
            if (readTxn != null && !readTxn.isNull()) DTLV.mdb_txn_abort(readTxn);
            if (env != null && !env.isNull()) DTLV.mdb_env_close(env);
            if (dbi != null) dbi.close();
            if (key != null) key.close();
            if (value != null) value.close();
        }
    }
}
