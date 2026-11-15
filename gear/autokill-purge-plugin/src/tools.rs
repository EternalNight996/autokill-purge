//! The four pure tools of autokill-purge. This module imports nothing but `serde_json`, so it is
//! testable on its own (see ../tools-check) and reused verbatim by the WASM plugin in `lib.rs`.
//! Contract: REQUIREMENTS.md v1.0 §5.2 — each tool is (input: string) -> string(JSON).

use serde_json::{Value, json};

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

// A marker's confidence: section names and byte-magics are strong signals; a bare product name
// can appear in help text and is weaker.
fn marker_confidence(needle: &str) -> f64 {
    if needle.starts_with('.') || needle.starts_with("UPX") || needle.starts_with("MPRESS") || needle.starts_with("PEC2") || needle.starts_with("proguard") || needle.starts_with("com.") || needle.ends_with('!') {
        0.9
    } else {
        0.6
    }
}

pub fn scan_packer_markers(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let mut lines: Vec<String> = Vec::new();
    if let Some(texts) = v.get("texts").and_then(|t| t.as_array()) {
        for t in texts {
            if let Some(s) = t.as_str() { lines.push(s.to_string()); }
        }
    }
    if lines.is_empty() {
        if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
            for line in text.lines() { lines.push(line.to_string()); }
        }
    }
    if let Some(sections) = v.get("sections").and_then(|s| s.as_array()) {
        for s in sections {
            if let Some(name) = s.as_str() { lines.push(name.to_string()); }
        }
    }
    if lines.is_empty() {
        return Err("texts or text is required".to_string());
    }

    let mut hits = Vec::new();
    let mut products: Vec<&str> = Vec::new();
    for (line_no, line) in lines.iter().enumerate() {
        for (product, needles) in MARKERS {
            for needle in *needles {
                if line.contains(needle) {
                    if !products.contains(product) {
                        products.push(product);
                    }
                    hits.push(json!({
                        "line": line_no + 1,
                        "text": line.trim(),
                        "marker": needle,
                        "product": product,
                        "confidence": marker_confidence(needle),
                    }));
                }
            }
        }
    }
    let matched = !hits.is_empty();
    let note = if matched {
        "A marker names a product only because a string matched; a modified packer can hide its markers."
    } else {
        "No marker matched. That is not proof the target is unpacked: read the sections and imports before concluding."
    };
    Ok(json!({"matched": matched, "hits": hits, "products": products, "note": note}))
}

const CHECK_WORDS: &[&str] = &[
    "licen", "serial", "activat", "regist", "trial", "expire", "valid", "signature", "verify",
    "auth", "token", "subscri", "hwid", "entitle", "unlock", "purchase",
];

fn xref_count(v: &Value, key: &str) -> i64 {
    match v.get(key) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::Array(a)) => a.len() as i64,
        _ => 0,
    }
}

pub fn rank_check_candidates(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;

    let mut rows: Vec<(String, i64, Vec<String>)> = Vec::new();
    if let Some(strings) = v.get("strings").and_then(|s| s.as_array()) {
        let xrefs = v.get("xrefs");
        for s in strings {
            let text = match s {
                Value::String(t) => t.clone(),
                Value::Object(o) => o.get("string").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                _ => String::new(),
            };
            if text.is_empty() { continue; }
            let refs = xrefs.map(|x| xref_count(x, &text)).unwrap_or(0);
            rows.push((text, refs, Vec::new()));
        }
    } else if let Some(candidates) = v.get("candidates").and_then(|c| c.as_array()) {
        for c in candidates {
            let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
            let refs = c.get("refs").and_then(|n| n.as_i64()).unwrap_or(0);
            let mut extra: Vec<String> = Vec::new();
            if let Some(words) = c.get("strings").and_then(|s| s.as_array()) {
                for w in words {
                    if let Some(t) = w.as_str() { extra.push(t.to_string()); }
                }
            }
            rows.push((name, refs, extra));
        }
    }
    if rows.is_empty() {
        return Err("strings or candidates is required".to_string());
    }

    let mut ranked: Vec<Value> = Vec::new();
    for (name, refs, extra) in rows {
        let mut reasons: Vec<String> = Vec::new();
        let mut missing: Vec<&str> = Vec::new();
        let mut score: i64 = 0;
        let lower = name.to_ascii_lowercase();
        let word_hit = CHECK_WORDS.iter().any(|w| lower.contains(*w));
        let extra_hit = extra.iter().any(|s| {
            let t = s.to_ascii_lowercase();
            CHECK_WORDS.iter().any(|w| t.contains(*w))
        });
        if word_hit || extra_hit {
            score += 30;
            reasons.push("licence or auth keyword".to_string());
        } else {
            missing.push("no licence/auth keyword: treat the score as weak");
        }
        if refs > 0 {
            score += refs.min(50) * 2;
            reasons.push(format!("{refs} reference(s)"));
        } else {
            missing.push("no reference counted: check xrefs before trusting the score");
        }
        ranked.push(json!({"target": name, "score": score, "reasons": reasons, "missing": missing}));
    }
    ranked.sort_by(|a, b| {
        let sa = a.get("score").and_then(|x| x.as_i64()).unwrap_or(0);
        let sb = b.get("score").and_then(|x| x.as_i64()).unwrap_or(0);
        sb.cmp(&sa)
    });
    Ok(json!({
        "ranked": ranked,
        "note": "The score orders where to look first. It is not evidence that a target decides anything: read it before claiming it does."
    }))
}

pub fn plan_unpack(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let format = v.get("format").and_then(|f| f.as_str()).unwrap_or("").to_ascii_lowercase();
    if format.is_empty() {
        return Err("format is required".to_string());
    }
    let packer = v.get("packer").and_then(|p| p.as_str()).unwrap_or("").to_string();
    let mut steps: Vec<Value> = Vec::new();
    match format.as_str() {
        "apk" => {
            steps.push(json!({"tool": "android_apk_show", "why": "entries, DEX count, signing, packing hints", "passCondition": "a manifest and at least one DEX are readable", "needsProcess": false}));
            steps.push(json!({"tool": "android_dex_show", "why": "classes, methods, string literals", "passCondition": "the string pool reads without a decryptor error", "needsProcess": false}));
            if packer.to_ascii_lowercase().contains("guard") {
                steps.push(json!({"tool": "android_string_decrypt_plan", "why": "name the string encryption before touching methods", "passCondition": "the decryptor is named and its call shape recorded", "needsProcess": false}));
            }
        }
        "asar" | "electron" | "js" => {
            steps.push(json!({"tool": "js_bundle_show", "why": "modules, entry, source maps", "passCondition": "the module graph parses", "needsProcess": false}));
            steps.push(json!({"tool": "js_bundle_unpack", "why": "split the bundle into modules", "passCondition": "each module parses on its own", "needsProcess": false}));
            steps.push(json!({"tool": "js_bundle_locate", "why": "find the licence check and its callers", "passCondition": "one candidate compares against stored data", "needsProcess": false}));
        }
        "macho" | "elf" | "pe" | "exe" | "dll" => {
            steps.push(json!({"tool": "native_binary_show", "why": "sections, imports, entry, protections", "passCondition": "sections and imports are read", "needsProcess": false}));
            if packer.is_empty() {
                steps.push(json!({"tool": "native_packer_scan", "why": "decide whether it is packed before disassembling", "passCondition": "markers matched, or sections and imports explain the size", "needsProcess": false}));
            }
            steps.push(json!({"tool": "native_functions_list", "why": "function inventory with sizes and reference counts", "passCondition": "functions are named and the entry is inside one", "needsProcess": false}));
            steps.push(json!({"tool": "native_function_show", "why": "read the top candidate whole", "passCondition": "a branch on comparison data is visible", "needsProcess": false}));
        }
        _ => {
            steps.push(json!({"tool": "core_triage", "why": "establish the format before choosing a path", "passCondition": "a format and architecture are named", "needsProcess": false}));
        }
    }
    Ok(json!({
        "format": format,
        "packer": packer,
        "steps": steps,
        "note": "Static steps first. Anything that needs a running process belongs behind an approval, not in this plan."
    }))
}

// An evidence entry refutes a claim when it is a string starting with "reject:"/"refute:" or an
// object with verdict "reject".
fn refutes(evidence: &Value) -> bool {
    let arr = match evidence.as_array() { Some(a) => a, None => return false };
    arr.iter().any(|e| match e {
        Value::String(s) => s.starts_with("reject:") || s.starts_with("refute:"),
        Value::Object(o) => o.get("verdict").and_then(|x| x.as_str()) == Some("reject"),
        _ => false,
    })
}

pub fn audit_claims(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("input is not JSON: {e}"))?;
    let claims = v.get("claims").and_then(|c| c.as_array()).ok_or("claims is required")?;
    let mut accepted: Vec<Value> = Vec::new();
    let mut todo: Vec<Value> = Vec::new();
    let mut rejected: Vec<Value> = Vec::new();
    for c in claims {
        let text = c.get("text").and_then(|t| t.as_str()).unwrap_or("");
        let evidence = c.get("evidence").cloned().unwrap_or(Value::Null);
        let ids = evidence.as_array().map(|a| a.len()).unwrap_or(0);
        if refutes(&evidence) {
            rejected.push(json!({"text": text, "evidence": ids}));
        } else if ids > 0 {
            accepted.push(json!({"text": text, "evidence": ids}));
        } else {
            todo.push(json!({"text": text}));
        }
    }
    Ok(json!({
        "accepted": accepted,
        "todo": todo,
        "rejected": rejected,
        "note": "A claim without evidence is an open question (todo), not a finding."
    }))
}
