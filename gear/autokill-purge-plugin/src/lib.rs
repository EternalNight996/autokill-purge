//! Armour-piercing gear for AutoKill: four pure tools that answer the questions every unpacking
//! job starts with. It implements the tools interface from wit/plugin.wit and imports nothing, so
//! AutoKill runs it without asking and nothing leaves the machine.
//!
//! The tool logic lives in `tools.rs` (serde_json only, unit-tested); this file is the thin WASM
//! glue that exposes it through the AutoKill plugin interface.

mod tools;

use serde_json::{Value, json};

wit_bindgen::generate!({
    path: "wit/plugin.wit",
    world: "plugin",
});

struct Plugin;

impl exports::autokill::plugin::tools::Guest for Plugin {
    fn describe() -> String {
        json!([
            {
                "name": "scan_packer_markers",
                "title": "Scan for packer markers",
                "description": "Name the packer or protector behind a target from text you already collected (strings, section names, a hexdump). Reports which marker matched and where, or says nothing matched - never a guess without a match.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "texts": {"type": "array", "items": {"type": "string"}, "description": "Collected strings or hexdump lines, one item per line."},
                        "sections": {"type": "array", "items": {"type": "string"}, "description": "Optional section names to scan too."}
                    }
                }
            },
            {
                "name": "rank_check_candidates",
                "title": "Rank check candidates",
                "description": "Order the strings (targets) most likely to be the licence or authorisation check, from facts you already have (the strings and their code references). Each target comes back with the reasons it scored and what is still missing.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "strings": {"type": "array", "items": {"type": "string"}, "description": "Candidate strings, one per item."},
                        "xrefs": {"type": "object", "description": "Map of string -> reference count (or array of reference offsets)."}
                    }
                }
            },
            {
                "name": "plan_unpack",
                "title": "Plan an unpack",
                "description": "Turn what is known (format, packer) into an ordered plan of AutoKill tool ids, cheapest first, with the check each step must pass before the next is worth running.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "format": {"type": "string"},
                        "packer": {"type": "string"}
                    },
                    "required": ["format"]
                }
            },
            {
                "name": "audit_claims",
                "title": "Audit claims",
                "description": "Split a list of claims into the ones an evidence id backs (accepted), the ones it does not (todo, downgraded to open questions) and the ones the evidence refutes (rejected), so a report cannot present a guess as a finding.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "claims": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string"},
                                    "evidence": {"type": "array", "items": {"type": "string"}}
                                },
                                "required": ["text", "evidence"]
                            }
                        }
                    },
                    "required": ["claims"]
                }
            }
        ])
        .to_string()
    }

    fn call(name: String, input: String) -> String {
        let answer = match name.as_str() {
            "scan_packer_markers" => tools::scan_packer_markers(&input),
            "rank_check_candidates" => tools::rank_check_candidates(&input),
            "plan_unpack" => tools::plan_unpack(&input),
            "audit_claims" => tools::audit_claims(&input),
            other => Err(format!("this gear has no tool called {other}")),
        };
        match answer {
            Ok(v) => json!({"ok": v}),
            Err(e) => json!({"error": e}),
        }
        .to_string()
    }
}
