(ns eacl-demo.local-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.local :as local]))

(deftest qualified-native-backends
  (doseq [backend ["datomic" "datahike"]]
    (testing backend
      (let [backends (:backends @local/runtime)
            base {"backend" backend "subject" {"type" "user" "id" "alice"}
                  "resource" {"type" "doc" "id" (str "test-region-" (random-uuid))} "permission" "view"}
            check #(get-in (local/invoke! backends (assoc base "operation" "check" "context" %))
                           [:result :permissionship])
            temporary (assoc base "resource" {"type" "doc" "id" (str "test-" (random-uuid))}
                             "relation" "viewer")
            invoke #(local/invoke! backends (merge temporary %))]
        (try
          (local/invoke! backends (assoc base "operation" "write" "relation" "viewer"
                                         "caveat" "in_region" "caveatContext" {"accepted" ["za"]}))
          (is (= :conditional-permission (check {})))
          (is (= :has-permission (check {"region" "za"})))
          (is (= :no-permission (check {"region" "us"})))
          (is (string? (get-in (local/invoke! backends (assoc base "operation" "info")) [:result :schema])))
          (invoke {"operation" "write" "validUntilMs" (+ (System/currentTimeMillis) 2500)})
          (is (= :has-permission (get-in (invoke {"operation" "check"}) [:result :permissionship])))
          (Thread/sleep 2600)
          (is (= :no-permission (get-in (invoke {"operation" "check"}) [:result :permissionship])))
          (finally
            (invoke {"operation" "delete"})
            (local/invoke! backends (assoc base "operation" "delete" "relation" "viewer"))))))))
