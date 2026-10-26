/* Audio Writer: the step-by-step tour, the same as the Control Room's (Claude, 24 Oct 2026).
   Help shows it any time; the first two times the app opens it shows by itself. */
(function (root) {
const STEPS = [
  ["[data-tour=status]", "This line says what is happening. Next to it you can see whether the microphone is on."],
  ["[data-tour=oms]", "My writings: the writings you picked in the Control Room (open a writing there and tap Listen in Audio Writer). Tap one to load it. Refresh the list after picking more."],
  ["#draft", "Left: the text being read to you. While it reads, it scrolls by itself and lights up the sentence and word you are hearing, so you can read along. Pause to change words, then press Save new local version to keep your change."],
  ["[data-tour=live]", "Right: the words you say, appearing as you speak. Grey words are still being worked out."],
  ["[data-tour=voice]", "Spoken commands: while an audio note is recording you can say pause, keep reading, go back, repeat, next, scratch that, cut thirty seconds, new note or send my notes. Say each on its own with a short pause around it. The full list is here."],
  ["[data-tour=scrollmode]", "Scroll and talk: nothing is read aloud. You scroll the text yourself, start an audio note and talk. Each piece of what you say is attached to the sentence that was lit in the box when you said it."],
  ["[data-tour=controls]", "Start begins reading aloud and recording together, so you can just talk. In Scroll and talk it only starts recording. Pause reading stops the reading but keeps listening. Stop ends both and keeps your note."],
  ["[data-tour=move]", "Back, Replay and Next move the reading by one sentence."],
  ["[data-tour=speed]", "Slower and Faster change the reading speed. A− and A+ change the size of the text. You can also say faster, slower, bigger text or smaller text."],
  ["[data-tour=extra]", "Flag this sentence marks it to come back to. Read my last note reads back the last thing you said. Undo takes back the last scratch, cut or flag. Each has a spoken command too."],
  ["[data-tour=fix]", "Said something you want gone? Cut last 30 s or Cut last minute removes those words and that bit of recording, and keeps recording if you were. Scrap note & retry throws the note away and starts it again. Start over goes back to the first sentence and moves this writing's notes to Deleted notes, where you can restore them. Delete all progress removes this writing's notes and recordings for good. Cuts can be undone on the note."],
  ["[data-tour=beside]", "Your notes beside the writing: each piece of what you said sits next to the sentence that was being read when you said it. Tap a sentence to read from there. Tap a block of your words to edit it or delete it."],
  ["[data-tour=notes]", "Your notes. You can also type one here. Each note can be played back and has Delete. Deleted notes wait under Deleted notes, where you can restore them or delete them for good."],
  ["[data-tour=send]", "When you are done, Send my notes to the Control Room. They wait beside the writing for Claude, Zephyr and you. Nothing changes unless you choose."],
  ["#helpbtn", "Press Help any time to see this again."],
];
const KEY = "audio_writer_tour_seen";
const $ = id => document.getElementById(id);
const Tour = {
  steps: [], i: 0,
  start(force) {
    this.steps = STEPS.filter(s => document.querySelector(s[0]));
    if (!this.steps.length) return;
    this.i = 0; $("tour").hidden = false; this.show();
    if (!force) { try { localStorage.setItem(KEY, String(this.seen() + 1)); } catch (e) {} }
  },
  seen() { try { return +localStorage.getItem(KEY) || 0; } catch (e) { return 99; } },
  show() {
    document.querySelectorAll(".tour-hl").forEach(e => e.classList.remove("tour-hl"));
    const [sel, text] = this.steps[this.i];
    $("tourtext").textContent = text;
    $("tourstep").textContent = "Step " + (this.i + 1) + " of " + this.steps.length;
    $("tournext").textContent = this.i === this.steps.length - 1 ? "Done" : "Next";
    const el = document.querySelector(sel);
    if (el) { el.classList.add("tour-hl"); if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  },
  move(d) { this.i = Math.max(0, this.i + d); if (this.i >= this.steps.length) return this.end(); this.show(); },
  end() { $("tour").hidden = true; document.querySelectorAll(".tour-hl").forEach(e => e.classList.remove("tour-hl")); },
};
$("helpbtn").onclick = () => Tour.start(true);
$("tournext").onclick = () => Tour.move(1);
$("tourback").onclick = () => Tour.move(-1);
$("tourskip").onclick = () => Tour.end();
if (Tour.seen() < 2) Tour.start(false);
root.Tour = Tour;
})(typeof window !== "undefined" ? window : this);
