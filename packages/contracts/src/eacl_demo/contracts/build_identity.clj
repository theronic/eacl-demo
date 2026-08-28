(ns eacl-demo.contracts.build-identity
  "Reads the immutable EACL source identity embedded in a JVM service JAR."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]))

(def ^:private resource-name
  "META-INF/eacl-demo/build-identity.v1.json")
(def ^:private sha-pattern #"[0-9a-f]{40}")

(defn- load-identity!
  []
  (let [resource (io/resource resource-name)]
    (when-not resource
      (throw (ex-info "The JVM build identity is absent from the artifact."
                      {:type :eacl-demo/missing-build-identity})))
    (let [identity (json/read-str (slurp resource) :key-fn keyword)]
      (when-not (and (= #{:schema :eaclSha} (set (keys identity)))
                     (= "eacl-demo.jvm-build-identity.v1" (:schema identity))
                     (re-matches sha-pattern (or (:eaclSha identity) "")))
        (throw (ex-info "The JVM build identity is invalid."
                        {:type :eacl-demo/invalid-build-identity})))
      identity)))

(defonce ^:private baked-identity (delay (load-identity!)))

(defn eacl-sha
  "Returns the EACL Git SHA baked into this exact JAR during the build."
  []
  (:eaclSha @baked-identity))
