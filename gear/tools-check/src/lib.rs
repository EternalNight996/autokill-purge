// Offline verification harness: includes the plugin's actual tools.rs verbatim and exercises the
// four tools against the §5.2 acceptance criteria (AC-9.1 / AC-9.2 / AC-9.3 and more).
#[path = "../../autokill-purge-plugin/src/tools.rs"]
pub mod tools;

#[cfg(test)]
mod tests {
    use super::tools::*;
    use serde_json::json;

    fn call(f: &dyn Fn(&str) -> Result<serde_json::Value, String>, input: serde_json::Value) -> serde_json::Value {
        f(&input.to_string()).expect("tool should return Ok")
    }

    #[test]
    fn ac_9_1_upx_hit_with_line() {
        let r = call(&scan_packer_markers, json!({"texts": ["hello world", "packed with UPX! v3.96", "nothing here"], "sections": [".text", ".data"]}));
        assert_eq!(r["matched"], true);
        assert_eq!(r["hits"].as_array().unwrap().len(), 1);
        assert_eq!(r["hits"][0]["marker"], "UPX!");
        assert_eq!(r["hits"][0]["line"], 2);
        assert_eq!(r["hits"][0]["product"], "UPX");
        assert!(r["hits"][0]["confidence"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn ac_9_2_unrelated_no_recommendation() {
        let r = call(&scan_packer_markers, json!({"texts": ["totally", "unrelated", "text"]}));
        assert_eq!(r["matched"], false);
        assert!(r["hits"].as_array().unwrap().is_empty());
    }

    #[test]
    fn ac_9_3_audit_no_evidence_todo() {
        let r = call(&audit_claims, json!({"claims": [
            {"text": "packer is UPX", "evidence": ["e1"]},
            {"text": "licence check at 0x1234", "evidence": []}
        ]}));
        assert_eq!(r["accepted"].as_array().unwrap().len(), 1);
        assert_eq!(r["todo"].as_array().unwrap().len(), 1);
        assert_eq!(r["todo"][0]["text"], "licence check at 0x1234");
    }

    #[test]
    fn audit_rejected_on_refute_marker() {
        let r = call(&audit_claims, json!({"claims": [
            {"text": "no packing", "evidence": ["reject: sections explain the size"]}
        ]}));
        assert_eq!(r["rejected"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn plan_unpack_has_pass_conditions() {
        let r = call(&plan_unpack, json!({"format": "pe", "packer": ""}));
        assert!(r["steps"].as_array().unwrap().len() >= 3);
        for s in r["steps"].as_array().unwrap() {
            assert!(s["passCondition"].is_string());
            assert!(s["needsProcess"].is_boolean());
        }
    }

    #[test]
    fn rank_uses_strings_and_xrefs() {
        let r = call(&rank_check_candidates, json!({"strings": ["activation key", "hello"], "xrefs": {"activation key": 12, "hello": 0}}));
        let ranked = r["ranked"].as_array().unwrap();
        assert_eq!(ranked[0]["target"], "activation key");
        assert_eq!(ranked[0]["missing"].as_array().unwrap().len(), 0);
        assert!(ranked[1]["missing"].as_array().unwrap().len() >= 1);
    }
}
