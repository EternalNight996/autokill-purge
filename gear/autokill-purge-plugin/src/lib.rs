//! Armour-piercing gear for AutoKill: four pure tools that answer the questions every unpacking
//! job starts with. It implements the tools interface from wit/plugin.wit and imports nothing, so
//! AutoKill runs it without asking and nothing leaves the machine.

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
                        "text": {"type": "string", "description": "Strings, section names or a hexdump, one item per line."},
                        "format": {"type": "string", "description": "Optional container hint: pe, elf, macho, apk, asar, js."}
                    },
                    "required": ["text"]
                }
            },
            {
                "name": "rank_check_candidates",
                "title": "Rank check candidates",
                "description": "Order the functions most likely to decide a licence or authorisation check, from facts you already have (references, comparisons, strings). Each candidate comes back with the reasons it scored.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "candidates": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "refs": {"type": "integer", "description": "How many places call or reference it."},
                                    "compares": {"type": "integer", "description": "How many comparisons it holds."},
                                    "strings": {"type": "array", "items": {"type": "string"}},
                                    "size": {"type": "integer"}
                                },
                                "required": ["name"]
                            }
                        }
                    },
                    "required": ["candidates"]
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
                        "packer": {"type": "string"},
                        "arch": {"type": "string"}
                    },
                    "required": ["format"]
                }
            },
            {
                "name": "audit_claims",
                "title": "Audit claims",
                "description": "Split a list of claims into the ones an evidence id backs and the ones it does not, so a report cannot present a guess as a finding.",
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
            "scan_packer_markers" => scan_packer_markers(&input),
            "rank_check_candidates" => rank_check_candidates(&input),
            "plan_unpack" => plan_unpack(&input),
            "audit_claims" => audit_claims(&input),
            other => Err(format!("this gear has no tool called {other}")),
        };
        match answer {
            Ok(v) => json!({"ok": v}),
            Err(e) => json!({"error": e}),
        }
        .to_string()
    }
}

const MARKERS: &[(&str, &[&str])] = &[
    ("VMProtect", &["vmp0", "vmp1", ".vmp", "VMProtect"]),
    ("Themida/WinLicense", &[".themida", "Themida", "SecureEngine"]),
    ("Enigma Protector", &[".enigma1", ".enigma2", "Enigma protector"]),
    ("UPX", &["UPX0", "UPX1", "UPX!"]),
    ("MPRESS", &[".MPRESS1", ".MPRESS2", "MPRESS"]),
    ("ASPack", &[".aspack", ".adata", "ASPack"]),
    ("PECompact", &["PEC2", "PECompact2"]),
    ("Obsidium", &[".obsidium", "Obsidium"]),
    ("SmartAssembly", &["SmartAssembly", ".NET Reactor"]),
    ("ConfuserEx", &["ConfusedByAttribute", "ConfuserEx"]),
    ("Electron ASAR", &["app.asar"]),
    ("ProGuard/R8", &["proguard", "com.android.tools.r8"]),
    ("DexGuard", &["DexGuard", "com.guardsquare"]),
    ("Dart AOT", &["libapp.so", "Dart VM"]),
];

fn scan_packer_markers(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let text = v.get("text").and_then(|t| t.as_str()).ok_or("text is required")?;
    let mut hits = Vec::new();
    let mut products: Vec<&str> = Vec::new();
    for (line_no, line) in text.lines().enumerate() {
        for (product, needles) in MARKERS {
            for needle in *needles {
                if line.contains(needle) {
                    if !products.contains(product) {
                        products.push(product);
                    }
                    hits.push(json!({
                        "product": product,
                        "marker": needle,
                        "line": line_no + 1,
                        "text": line.trim(),
                    }));
                }
            }
        }
    }
    let note = if hits.is_empty() {
        "No marker matched. That is not proof the target is unpacked: read the sections and imports before concluding."
    } else {
        "A marker names a product only because a string matched; a modified packer can hide its markers."
    };
    Ok(json!({"found": !hits.is_empty(), "hits": hits, "products": products, "note": note}))
}

const CHECK_WORDS: &[&str] = &[
    "licen", "serial", "activat", "regist", "trial", "expire", "valid", "signature", "verify",
    "auth", "token", "subscri", "hwid",
];

fn rank_check_candidates(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let list = v.get("candidates").and_then(|c| c.as_array()).ok_or("candidates is required")?;
    let mut scored: Vec<(i64, Value)> = Vec::new();
    for c in list {
        let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let refs = c.get("refs").and_then(|n| n.as_i64()).unwrap_or(0);
        let compares = c.get("compares").and_then(|n| n.as_i64()).unwrap_or(0);
        let size = c.get("size").and_then(|n| n.as_i64()).unwrap_or(0);
        let mut reasons: Vec<String> = Vec::new();
        let mut score: i64 = 0;
        let lower = name.to_ascii_lowercase();
        if let Some(word) = CHECK_WORDS.iter().find(|w| lower.contains(*w)) {
            score += 30;
            reasons.push(format!("name contains {word}"));
        }
        if let Some(words) = c.get("strings").and_then(|s| s.as_array()) {
            let mut matched = 0i64;
            for s in words {
                let text = s.as_str().unwrap_or("").to_ascii_lowercase();
                if CHECK_WORDS.iter().any(|w| text.contains(w)) {
                    matched += 1;
                }
            }
            if matched > 0 {
                score += 20 * matched.min(3);
                reasons.push(format!("{matched} string(s) look like licence or auth text"));
            }
        }
        if refs > 0 {
            score += refs.min(20) * 2;
            reasons.push(format!("{refs} reference(s)"));
        }
        if compares > 0 {
            score += compares.min(20);
            reasons.push(format!("{compares} comparison(s)"));
        }
        if size > 0 && size < 4096 {
            score += 5;
            reasons.push("small enough to read whole".to_string());
        }
        let mut missing: Vec<&str> = Vec::new();
        if refs == 0 {
            missing.push("no reference counted: check xrefs before trusting the score");
        }
        if compares == 0 {
            missing.push("no comparison counted: a check usually branches on one");
        }
        scored.push((score, json!({"name": name, "score": score, "reasons": reasons, "missing": missing})));
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    let ranked: Vec<Value> = scored.into_iter().map(|(_, value)| value).collect();
    Ok(json!({
        "ranked": ranked,
        "note": "The score orders where to look first. It is not evidence that a function decides anything: read it before claiming it does."
    }))
}

fn plan_unpack(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let format = v.get("format").and_then(|f| f.as_str()).unwrap_or("").to_ascii_lowercase();
    let packer = v.get("packer").and_then(|p| p.as_str()).unwrap_or("").to_string();
    let mut steps: Vec<Value> = Vec::new();
    match format.as_str() {
        "apk" => {
            steps.push(json!({"tool": "android_apk_show", "why": "entries, DEX count, signing, packing hints", "pass": "a manifest and at least one DEX are readable"}));
            steps.push(json!({"tool": "android_dex_show", "why": "classes, methods, string literals", "pass": "the string pool reads without a decryptor error"}));
            if packer.to_ascii_lowercase().contains("guard") {
                steps.push(json!({"tool": "android_string_decrypt_plan", "why": "name the string encryption before touching methods", "pass": "the decryptor is named and its call shape recorded"}));
            }
        }
        "asar" | "electron" | "js" => {
            steps.push(json!({"tool": "js_bundle_show", "why": "modules, entry, source maps", "pass": "the module graph parses"}));
            steps.push(json!({"tool": "js_bundle_unpack", "why": "split the bundle into modules", "pass": "each module parses on its own"}));
            steps.push(json!({"tool": "js_bundle_locate", "why": "find the licence check and its callers", "pass": "one candidate compares against stored data"}));
        }
        "macho" | "elf" | "pe" | "exe" | "dll" => {
            steps.push(json!({"tool": "native_binary_show", "why": "sections, imports, entry, protections", "pass": "sections and imports are read"}));
            if packer.is_empty() {
                steps.push(json!({"tool": "native_packer_scan", "why": "decide whether it is packed before disassembling", "pass": "markers matched, or sections and imports explain the size"}));
            }
            steps.push(json!({"tool": "native_functions_list", "why": "function inventory with sizes and reference counts", "pass": "functions are named and the entry is inside one"}));
            steps.push(json!({"tool": "native_function_show", "why": "read the top candidate whole", "pass": "a branch on comparison data is visible"}));
        }
        _ => {
            steps.push(json!({"tool": "core_triage", "why": "establish the format before choosing a path", "pass": "a format and architecture are named"}));
        }
    }
    Ok(json!({
        "format": format,
        "packer": packer,
        "steps": steps,
        "note": "Static steps first. Anything that needs a running process belongs behind an approval, not in this plan."
    }))
}

fn audit_claims(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let claims = v.get("claims").and_then(|c| c.as_array()).ok_or("claims is required")?;
    let mut backed: Vec<Value> = Vec::new();
    let mut unbacked: Vec<Value> = Vec::new();
    for c in claims {
        let text = c.get("text").and_then(|t| t.as_str()).unwrap_or("");
        let ids = c.get("evidence").and_then(|e| e.as_array()).map(|a| a.len()).unwrap_or(0);
        if ids > 0 {
            backed.push(json!({"text": text, "evidence": ids}));
        } else {
            unbacked.push(json!({"text": text}));
        }
    }
    Ok(json!({
        "backed": backed,
        "unbacked": unbacked,
        "note": "An unbacked claim is an open question, not a finding."
    }))
}
