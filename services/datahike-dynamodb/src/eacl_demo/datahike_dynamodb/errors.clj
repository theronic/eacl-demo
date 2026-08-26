(ns eacl-demo.datahike-dynamodb.errors
  "Closed error classification for the DynamoDB serving adapter."
  (:require [clojure.string :as string])
  (:import [java.net ConnectException SocketTimeoutException]
           [java.util.concurrent TimeoutException]
           [software.amazon.awssdk.awscore.exception AwsServiceException]
           [software.amazon.awssdk.core.exception SdkClientException SdkServiceException]
           [software.amazon.awssdk.services.dynamodb.model
            ProvisionedThroughputExceededException
            RequestLimitExceededException
            ResourceNotFoundException]))

(def error-type :eacl-demo/dynamodb-error)

(def ^:private throttling-error-codes
  #{"ProvisionedThroughputExceededException" "RequestLimitExceeded"
    "RequestLimitExceededException" "Throttling" "ThrottlingException"
    "ThrottledException"})

(def ^:private authorization-error-codes
  #{"AccessDenied" "AccessDeniedException" "Forbidden"
    "IncompleteSignature" "InvalidClientTokenId" "MissingAuthenticationToken"
    "SignatureDoesNotMatch" "UnrecognizedClientException"})

(defn dynamodb-error?
  [error]
  (= error-type (:type (ex-data error))))

(defn error
  [operation category code retryable? cause]
  (ex-info "DynamoDB serving read failed."
           {:type error-type
            :operation operation
            :category category
            :code code
            :retryable retryable?}
           cause))

(defn corrupt!
  [operation]
  (throw (error operation :corrupt "storage-corrupt" false nil)))

(defn- aws-error-code
  [error]
  (when (instance? AwsServiceException error)
    (some-> ^AwsServiceException error .awsErrorDetails .errorCode)))

(defn classify
  "Preserves already-classified errors and converts every dependency failure to
  one closed public code without converting it to absence."
  [operation throwable]
  (cond
    (dynamodb-error? throwable) throwable

    (and (instance? clojure.lang.ExceptionInfo throwable)
         (contains? #{"cancelled" "deadline-exceeded"}
                    (:code (ex-data throwable))))
    throwable

    (or (instance? ProvisionedThroughputExceededException throwable)
        (instance? RequestLimitExceededException throwable)
        (and (instance? SdkServiceException throwable)
             (or (.isThrottlingException ^SdkServiceException throwable)
                 (contains? throttling-error-codes (aws-error-code throwable)))))
    (error operation :throttled "throttled" true throwable)

    (instance? ResourceNotFoundException throwable)
    (error operation :missing "storage-missing" false throwable)

    (and (instance? AwsServiceException throwable)
         (or (= 403 (.statusCode ^AwsServiceException throwable))
             (contains? authorization-error-codes (aws-error-code throwable))))
    (error operation :authorization "dependency-unavailable" false throwable)

    (or (instance? TimeoutException throwable)
        (instance? SocketTimeoutException throwable))
    (error operation :timeout "dependency-unavailable" true throwable)

    (or (instance? ConnectException throwable)
        (instance? SdkClientException throwable))
    (error operation :transport "dependency-unavailable" true throwable)

    (and (instance? SdkServiceException throwable)
         (or (>= (.statusCode ^SdkServiceException throwable) 500)
             (.isRetryableException ^SdkServiceException throwable)))
    (error operation :service "dependency-unavailable" true throwable)

    :else
    (error operation :unexpected "internal-error" false throwable)))
