#!/usr/bin/env bash
# Live suite in the real side panel, one chat per test: the rest of the cleanup, each add alone, then all together.
cd "$(dirname "$0")" || exit 1
OUT=../indici-live/suite
mkdir -p $OUT

export PANEL=side CTX=65536 PROVIDER=kaggle MAX_STEPS=120 REQUEST_MINUTES=90
ANSWERS_ALL='[["reason", "follow up"], ["already in the active medicines", "Yes"], ["NZF|Formulary", "OK"], ["Recall.s. of Group|already exists", "Yes - Add new"], ["already there|add another|add it again", "Yes, add it"]]'
SAVE_ONLY='^(?!.*(Delete|Inactive|Click to cancel|cancel recall|Click “Complete|Overwrite)).*'

run() { # name, then env assignments for live-agent.mjs
  local name=$1; shift
  echo "=== $name $(date +%H:%M)"
  env "$@" timeout 6000 node live-agent.mjs > $OUT/$name.txt 2>&1
  cp ../indici-live/model-calls.json $OUT/$name-calls.json 2>/dev/null
  grep -E "^>>>|approval|steps ·|timed out|Error|declining" $OUT/$name.txt | cut -c1-200
  grep -vE "^\s*$|Details$|^Done$|^[0-9.]+s$" $OUT/$name.txt | tail -6 | cut -c1-260
}

# 1. The rest of the cleanup: the two test diagnoses, and the confidential test recall.
run cleanup2 \
  APPROVE='Essential hypertension \(Probable\) \(\[web|CBC recall 2|web agent test|Click “Yes”\?|Click “OK”\?|reason|confidential' \
  APPROVE_IF='[["reason to view|Reason", "follow up"]]' ANSWERS='[["reason", "follow up"]]' \
  REQUESTS='["delete Arya'"'"'s two diagnoses Essential hypertension whose summary has \"[web agent test]\" (serial 3 and serial 4) — only those", "make inactive (delete) Arya'"'"'s confidential recall CBC with the note \"[web agent test] CBC recall 2 - fasting\" — only that one"]'

# 2. Each add alone, in a chat of its own.
run single-med APPROVE="$SAVE_ONLY" ANSWERS="$ANSWERS_ALL" \
  APPROVE_IF='[["reason to view", "follow up"], ["Strength 500 mg", "Take 2 Frequency QID.*after food"]]' \
  REQUESTS='["add a medication for Arya: paracetamol 500 mg tablet, take 2, frequency QID, duration 2 days, repeats 1, directions \"Take 2 tablets four times daily after food\", private to pharmacist \"[web agent test] single med\" — save it"]'
run single-task APPROVE="$SAVE_ONLY" ANSWERS="$ANSWERS_ALL" \
  APPROVE_IF='[["reason to view", "follow up"], ["Subject / Progress", "single task - call patient"]]' \
  REQUESTS='["add a task for Arya: subject \"[web agent test] single task - call patient\", due in 2 weeks, priority Medium — save it"]'
run single-recall APPROVE="$SAVE_ONLY" ANSWERS="$ANSWERS_ALL" \
  APPROVE_IF='[["reason to view", "follow up"], ["Recall Group", "Recall Group Bloods Description HBA1C"]]' \
  REQUESTS='["add a recall for Arya: provider Training DOCTOR, recall group Bloods, description HBA1C, note \"[web agent test] single recall\", recall in 3 months — save it"]'
run single-dx APPROVE="$SAVE_ONLY" ANSWERS="$ANSWERS_ALL" \
  APPROVE_IF='[["reason to view", "follow up"]]' \
  REQUESTS='["add the diagnosis Essential hypertension for Arya: status Confirmed, onset date 12/10/2026, summary \"[web agent test] single dx\" — save it"]'

# 3. All together, in one request.
run serial5 APPROVE="$SAVE_ONLY" ANSWERS="$ANSWERS_ALL" \
  APPROVE_IF='[["reason to view", "follow up"], ["Strength 500 mg", "Take 1 Frequency TDS.*three times a day for pain"], ["Recall Group", "Recall Group Bloods Description CBC"], ["Subject / Progress", "serial 5 - review bloods"]]' \
  REQUESTS='["go to patients, select Arya Stark, then do these one after another: (1) add a medication: paracetamol 500 mg tablet, take 1, frequency TDS, duration 3 days, repeats 1, directions \"Take 1 tablet three times daily for pain\", private to pharmacist \"[web agent test] serial 5\" — save it; (2) add a task: subject \"[web agent test] serial 5 - review bloods\", due next week — save it; (3) add a recall: provider Training DOCTOR, recall group Bloods, description CBC, note \"[web agent test] serial 5 recall\", recall in 6 months — save it; (4) add the diagnosis Essential hypertension: status Probable, onset date 15/10/2026, summary \"[web agent test] serial 5\" — save it"]'
echo "=== done $(date +%H:%M)"
