package eacl_demo.datahike_s3;

import clojure.java.api.Clojure;
import clojure.lang.IFn;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestStreamHandler;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public final class LambdaHandler implements RequestStreamHandler {
  private static final IFn REQUIRE = Clojure.var("clojure.core", "require");
  private static final IFn READ = Clojure.var("clojure.core", "read-string");
  private static final IFn HANDLE;

  static {
    REQUIRE.invoke(READ.invoke("eacl-demo.datahike-s3.lambda-handler"));
    HANDLE = Clojure.var(
        "eacl-demo.datahike-s3.lambda-handler", "handle-request-stream");
  }

  @Override
  public void handleRequest(InputStream input, OutputStream output, Context context)
      throws IOException {
    HANDLE.invoke(input, output, context);
  }
}
