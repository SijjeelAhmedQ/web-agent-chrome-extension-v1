# Smart AI Inbox — Web Agent se kaise chalayein

Har feature ke saath: kya hota hai, kaunsa prompt dena hai, aur kya live test ho chuka hai (✓ = Kaggle Qwen3.8 27B par live chala; ◐ = chala lekin koi had hai; ○ = abhi live test nahi hua).

Prompts English mein likhe hain — model inhein sab se behtar samajhta hai. `<…>` ki jagah apni value daalein.

---

## 1. Ek baar ka setup

1. **Extension load karein:** `npm run build` → `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`. Naye build ke baad card par ↻ dabayein.
2. **Knowledge import karein (pehle yeh):** Options → **Advanced** → Configuration → Import → `knowledge/web-agent-restore-indici.json` → Import.
   - Is se dono sites (*indici*, *indici smart inbox*) aur dono agents (*indici agent*, *indici smart inbox agent*) aa jaate hain.
   - Import poori configuration badal deta hai, aur is file mein koi model connection nahi hai. Is liye Kaggle connection import **ke baad** banayein.
3. **Kaggle model jodein:** Kaggle par notebook `kaggle/web_agent_qwen38long_kaggle.ipynb` chalayein (GPU T4 ×2, Internet on). Phir Options → **Models** → Add connection → **Kaggle GPU**:
   - Address: notebook jo `trycloudflare.com` link print kare (`/vllm/v1` khud lag jaata hai).
   - Key: notebook ki key (`X-CareFlow-Key`).
   - Model: `qwen3.8:27b-q4_K_M`.
   - **Context window: 65536**. Kam rakha to lambe kaam beech mein toot jaate hain.
   - Notebook restart ho to link badal jaata hai: Models aur Voice mein naya link daalein.
4. **Voice (optional):** Options → Voice → **Allow microphone** ek baar → Whisper large-v3 turbo. Phir side panel mein mic se bol kar bhi request de sakte hain.
5. **Approvals on rakhein:** dono agents par *Ask before important actions* hai. Har Save, File, comment, tick box se pehle card aata hai. Ise band na karein.

## 2. Roz ka tareeqa

1. Chrome mein Indici kholein aur login karein.
2. Toolbar icon (ya `Alt+Shift+A`) se **side panel** kholein. Indici par *indici agent* khud chunn liya jaata hai.
3. Side panel mein likhein ya bolein: **`open smart inbox`** ✓
   - Agent Inbox panel ka ✦ "Open AI Assisted Inbox" icon dabata hai. Smart Inbox nayi tab mein khulta hai, login pehle se hota hai.
   - Smart Inbox tab par *indici smart inbox agent* khud aa jaata hai (status bar mein site chip dikhta hai).
4. Ab neeche wale prompts us tab par dein.

**Kaam ke dauran:**
- Agent jis tab par kaam kar raha ho, wahan khud click na karein, aur tab na badlein.
- Approval card par likha hota hai kya hoga (field, text, button). Sahi ho to **Approve**, warna **Decline**.
- Rokna ho to **Stop** (ya `Esc`).
- Indici ka session time out ho jaata hai; Smart Inbox login rehta hai. Indici wala kaam ho to pehle Indici mein dobara login karein.

---

## 3. Har feature, prompt ke saath

### 3.1 Dhoondna aur filters ✓
Patient Name, NHI, DOB (DD/MM/YYYY), Phone, Date range, aur dropdowns Status / File / Category / Subject / Providers / Sender / AI.
```
show unfiled abnormal lab records
find patient Arya STARK
how many normal, abnormal and unfiled records are there?
```

### 3.2 Patient aur record kholna, padhna ✓
```
open Arya STARK and read her latest record
show all records of Arya STARK, filed ones too
what does the record "<subject>" of Arya STARK say?
```
- Ek naam ke kai patients hon to agent naam, NHI aur umar ki list deta hai aur poochta hai.
- **Yaad rahe:** record kholte hi app use *read* mark kar deti hai.

### 3.3 Summary ✓
```
summarize all abnormal record
summarize all normal record
summarize all abnormal record of arya STARK
summarize all normal record of arya STARK
summarize all unfiled records of <patient>
```
- Agent pehle **Reset** karta hai, phir Status filter lagata hai.
- Records Next se padhta hai, ek call mein 100 tak, aur aakhir par "Load more" khud dabata hai.
- Normal ya abnormal ka faisla STATUS column se hota hai; jis record mein STATUS nahi, wahan list ka rang dekha jaata hai (laal = abnormal).
- Waqt: abnormal (93 records) ~6 min; normal (348) ~14 min.

### 3.4 Diagnostic comment ✓ / ◐
Ek record par:
```
add the diagnostic comment "<your words>" to the record "<subject>" of Arya STARK
```
Kai records par:
```
comment hello world to all abnormal records of arya stark
```
- Comment box type karte hi save ho jaata hai, is liye **har record par approval** aata hai. Card par text dikhta hai.
- Jis record mein pehle se comment ho, wahan agent ek baar poochta hai: badalna hai ya peeche jodna hai.
- Jo alfaaz pehle se hon, unhein dobara nahi likhta. Aakhir mein har record ki list deta hai: comment laga ya nahi.
- ◐ Pichhle test runs se Arya ke 3 records par "hello world" do baar laga hua hai; woh abhi theek nahi kiya gaya.

### 3.5 File / Unfile ✓
```
file the record "<subject>" of Arya STARK
unfile the record "<subject>" of Arya STARK
file all normal records of <patient>
```
- Pehle batata hai kitne records hain aur kya koi abnormal hai, phir approval leta hai.
- Abnormal record ho to "File All" aap ke kahe baghair nahi dabata.

### 3.6 Patient tick boxes ✓ / Opt Out ○
```
tick Confidential for Arya STARK
untick Do not show on Portal for Arya STARK
opt out Arya STARK from AI processing
```
- Tick boxes click hote hi save hote hain, is liye pehle approval.
- Opt Out "Revoke AI Consent" kholta hai. ○ Yeh live test abhi baqi hai.

### 3.7 Actions menu (⋮) — 7 items ✓
```
send an email to sijjeel.ahmed@f3technologies.eu about Arya STARK's test results
create a task for Arya STARK: "<subject>", due <DD/MM/YYYY>, to <provider>
create a recall for Arya STARK: group Bloods, description HBA1C, recall in 3 months
create an allergy for Arya STARK: Paracetamol, reaction rash, category Allergy
show the AI file audit of Arya STARK
show the audit log of the open record
```
- Required (*) field khaali ho to agent us field ka naam le kar poochta hai.
- Recall Group / Description na batayein to dropdown ke options dikha kar poochta hai.
- **Send Text** mareez ke number par jaata hai (number badla nahi ja sakta). Is liye test mein hamesha Send SMS par **Decline** karein.
- Email sirf us address par jaati hai jo aap dein.

### 3.8 Right panel — Patient AI Actions
App ka AI unfiled results dekh kar cards banata hai: ADD TASK, ADD RECALL, ADD DIAGNOSIS, DRAFT EMAIL, DRAFT TEXT. Har card ke do raaste hain: **quick edit** (card ke andar, phir Create) ya **Full Form**.

| Kaam | Quick edit | Full Form | Actions menu |
|---|---|---|---|
| Task | ✓ | ✓ | ✓ |
| Recall | ✓ | ✓ | ✓ |
| Diagnosis | ✓ | ◐ app khud "Something went wrong" deti hai jab Concept ID `<UNKNOWN>` ho; agent yeh batata hai aur quick edit offer karta hai | — (menu mein nahi) |
| Medication | — | — | — Smart Inbox mein ho hi nahi sakti |

```
open Aqib JAVED and add the suggested task
open Aqib JAVED and add the suggested task as urgent
open Aqib JAVED, open the suggested task in full form, set due date <DD/MM/YYYY>, and save it
open Aqib JAVED and add the suggested recall
open Aqib JAVED, open the suggested recall in full form, set Recall Group Bloods and Description HBA1C, and save it
open Aqib JAVED and add the suggested diagnosis
dismiss the suggested <task / recall / …> of Aqib JAVED
```
- "Full form" kahein to Full Form; warna quick edit.
- Card ka AI text sirf aap ke alfaaz se badalta hai.
- Card add ya dismiss ho kar list se hat jaata hai. Jo cards use ho chuke, woh dobara nahi milenge.
- Patient ka koi card na ho to agent bata deta hai. Naya task/recall Actions menu se banta hai (3.7).

### 3.9 Medication ✓ (Indici mein)
```
add Paracetamol 500 mg to Arya STARK
```
- Agent batata hai ke yeh Smart Inbox mein nahi hota, aur "Go to Consult" se Indici mein kholne ka poochta hai.
- Haan kahein to Indici ka "Add a medication in the consult" flow chalta hai, har Save par approval ke saath.

### 3.10 Clinical Summary aur Saved searches ✓ (sirf padhna)
Live chale 02/11/2026: Clinical Summary › Medications (aaj ki, long-term, pichhle 3 mahine) aur Saved searches (har filter ki values).
```
show the medications in Arya STARK's clinical summary
show the allergies in Arya STARK's clinical summary
show my saved searches
apply the saved search "<name>"
```
- Clinical Summary mein kuch save nahi hota.
- "Mark as Primary" aur "Delete" approval ke baad hi chalte hain.

### 3.11 Naya inbox record ✓ (Indici mein)
Yeh Indici tab par dein:
```
add a new inbox record for Arya STARK, subject "<subject>", folder Lab, provider <provider>, comment "<words>"
```
- Folder na batayein to agent list dikha kar poochta hai. OK aur har lab test ke Save par approval aata hai.
- Record Smart Inbox mein unfiled dikhta hai. Indici mein inbox record delete nahi hota; ghalat ho to file karein.

---

## 4. Poore transcripts (ek request, kai qadam)

Inhein bilkul aise hi copy karein; naam aur values apni daal lein. Har likhne wale qadam par approval aayega.

**Naya line:** message box mein Enter dabate hi message chala jaata hai. Kai lines likhni hon to **Shift+Enter** dabayein, ya poora transcript ek hi line mein likhein (`…then: 1. … ; 2. …`). Paste karne se lines theek rehti hain.

> **B** ek hi request mein live ✓ chala (27/10/2026, Qwen3.8 27B, ~12 min): Indici se Smart Inbox, Arya list se khuli, task aur recall dono save, har Save par approval.
> **C** ek hi request mein live chala (02/11/2026, ~9 min): task ✓ aur recall ✓ save; diagnosis par app ne "Something went wrong" diya — agent ne dobara nahi dabaya aur bata diya.
> Baaqi (A, D–F) ab tak ek hi run mein nahi chale — har qadam alag alag ✓ hai (upar dekhein).

**A. Navigation se padhne tak**
```
open smart inbox, find Arya STARK, show all her records (filed ones too), and summarize which are abnormal with the abnormal tests
```

**B. Navigation se task aur recall (Actions menu)** ✓
```
open smart inbox, open Arya STARK, then: 1. create a task: subject "[web agent test] follow up bloods", due <DD/MM/YYYY>; 2. create a recall: group Bloods, description HBA1C, recall in 3 months. Tell me after each one whether it saved.
```
- Task ka "To" na batayein to form ka pehle se bhara provider (jo login hai) rehta hai.

**C. AI ke suggestions se (right panel)** ✓ (diagnosis app ki taraf se fail ho sakta hai)
```
open smart inbox, open Aqib JAVED, then from Patient AI Actions:
1. add the suggested task
2. add the suggested recall
3. add the suggested diagnosis
Use the quick edit for each and tell me what was added.
```

**D. Full Form ke saath**
```
open smart inbox, open Aqib JAVED, open the suggested task in full form, set due date <DD/MM/YYYY>, save it; then open the suggested recall in full form, set Recall Group Bloods and Description HBA1C, and save it
```

**E. Saari clinical cheezein (Smart Inbox + Indici)**
```
open smart inbox, open Arya STARK, create a task "[web agent test] review results" due <DD/MM/YYYY>, create a recall group Bloods description CBC recall in 6 months, then go to her consult in Indici and add Paracetamol 500 mg and the diagnosis "<diagnosis>"
```
- Medication aur diagnosis is mein Indici consult mein jaate hain. Indici login zinda hona chahiye.

**F. Padhna + comment + file**
```
summarize all abnormal records of Arya STARK, add the diagnostic comment "reviewed" to each, then tell me which ones are still unfiled
```

---

## 5. Had aur hidayat

- **Approval kabhi band nahi** — har likhne wale qadam par card aata hai.
- **Send Text** asli mareez ko jaata hai: test mein hamesha Decline. Email sirf apne address par.
- **Read state:** padhna bhi record ko read mark kar deta hai.
- **Lamba kaam:** 100 se zyada records ho to agent khud agli call karta hai. Ruk jaaye to side panel ki History mein us task par **Resume** dabayein.
- **Test entries** mein "[web agent test]" likhein, taa ke baad mein pehchan ho.
- Diagnosis Full Form ka Save abhi app ki taraf se fail hota hai (Concept ID `<UNKNOWN>`); quick edit kaam karta hai.
