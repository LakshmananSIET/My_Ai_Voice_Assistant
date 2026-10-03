let recognition = null;
let conversationActive = false;
let waitingForReply = false;
let speechInProgress = false;
let restartTimer = null;
let reminderTimers = new Map();
let savedReminders = JSON.parse(localStorage.getItem("jannu_reminders") || "[]");

const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const cameraInput = document.getElementById("cameraInput");
const statusText = document.getElementById("status");
const chatBox = document.getElementById("chatBox");

let savedTasks = JSON.parse(localStorage.getItem("ai_tasks") || "[]");
let savedNotes = JSON.parse(localStorage.getItem("ai_notes") || "[]");

renderDashboard();
restoreReminders();
initSpeechRecognition();

micBtn.addEventListener("click", async () => {
    if (conversationActive) stopConversation();
    else await startConversation();
});

cameraBtn.addEventListener("click", () => cameraInput.click());

cameraInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("prompt", "Describe this image briefly in natural Tanglish.");
    statusText.innerText = "Image check pannitu irukken...";
    try {
        const response = await fetch("/api/vision", { method: "POST", body: formData });
        const data = await response.json();
        appendMessage("📸 [Image]", "user");
        appendMessage(data.description || "Image analyse panna mudiyala.", "ai");
        await speakAndResume(data.audio_b64);
    } catch (_) {
        appendMessage("Image process panna mudiyala.", "ai");
        statusText.innerText = "Mic start pannunga";
    } finally {
        cameraInput.value = "";
    }
});

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        statusText.innerText = "Chrome/Edge use pannunga - voice recognition support venum.";
        micBtn.disabled = true;
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        speechInProgress = true;
        micBtn.classList.add("recording");
        statusText.innerText = "Listening...";
    };

    recognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript.trim();
        speechInProgress = false;
        if (!transcript || !conversationActive) return;

        waitingForReply = true;
        statusText.innerText = "Jannu yosichitu irukken...";
        appendMessage(transcript, "user");

        try {
            if (isReminderRequest(transcript)) {
                const reminderResponse = await fetch("/api/reminder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: transcript })
                });
                const reminderData = await reminderResponse.json();
                appendMessage(reminderData.message || "Reminder set panna mudiyala.", "ai");
                if (reminderData.ok) {
                    saveAndScheduleReminder(reminderData.title, reminderData.due_at);
                }
                await speakAndResume(reminderData.ok
                    ? await makeSpeech(reminderData.message)
                    : "");
                return;
            }

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: transcript })
            });
            const data = await response.json();
            appendMessage(data.response_text || "Sorry sir, answer kedaikala.", "ai");
            await speakAndResume(data.audio_b64);
        } catch (_) {
            appendMessage("Network problem sir. Again try pannunga.", "ai");
            waitingForReply = false;
            startListeningSoon();
        }
    };

    recognition.onerror = (event) => {
        speechInProgress = false;
        micBtn.classList.remove("recording");
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            conversationActive = false;
            statusText.innerText = "Microphone permission allow pannunga.";
            return;
        }
        if (conversationActive && !waitingForReply) startListeningSoon();
    };

    recognition.onend = () => {
        speechInProgress = false;
        micBtn.classList.remove("recording");
        if (conversationActive && !waitingForReply) startListeningSoon();
    };
}

async function startConversation() {
    if (!recognition) return;
    conversationActive = true;
    waitingForReply = false;
    statusText.innerText = "Mic permission ketkalam...";
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        if ("Notification" in window && Notification.permission === "default") {
            await Notification.requestPermission();
        }
        startListeningSoon(0);
    } catch (error) {
        conversationActive = false;
        statusText.innerText = "Microphone permission allow pannunga.";
        alert("Microphone access required: " + error.message);
    }
}

function stopConversation() {
    conversationActive = false;
    waitingForReply = false;
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    if (recognition && speechInProgress) {
        try { recognition.stop(); } catch (_) {}
    }
    micBtn.classList.remove("recording");
    statusText.innerText = "Mic start pannunga";
}

function startListeningSoon(delay = 400) {
    if (!conversationActive || waitingForReply || speechInProgress) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        if (!conversationActive || waitingForReply || speechInProgress) return;
        try {
            recognition.start();
        } catch (_) {
            setTimeout(() => {
                if (conversationActive && !waitingForReply) startListeningSoon(700);
            }, 700);
        }
    }, delay);
}

async function speakAndResume(audioB64) {
    waitingForReply = false;
    if (!conversationActive) return;
    if (!audioB64) {
        statusText.innerText = "Listening...";
        startListeningSoon(300);
        return;
    }
    statusText.innerText = "Jannu pesura...";
    try {
        const audio = new Audio("data:audio/mp3;base64," + audioB64);
        await new Promise((resolve) => {
            audio.onended = resolve;
            audio.onerror = resolve;
            audio.play().catch(resolve);
        });
    } finally {
        if (conversationActive) {
            statusText.innerText = "Listening...";
            startListeningSoon(300);
        }
    }
}


function isReminderRequest(text) {
    return /\b(remind|reminder|remember|nyabagam|ninaivu)\b/i.test(text);
}

async function makeSpeech(text) {
    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const data = await response.json();
        return data.audio_b64 || "";
    } catch (_) {
        return "";
    }
}

function saveAndScheduleReminder(title, dueAt) {
    const reminder = {
        id: crypto.randomUUID(),
        title,
        dueAt,
        createdAt: new Date().toISOString(),
        done: false
    };
    savedReminders.push(reminder);
    localStorage.setItem("jannu_reminders", JSON.stringify(savedReminders));
    scheduleReminder(reminder);
    renderDashboard();
}

function restoreReminders() {
    const now = Date.now();
    savedReminders = savedReminders.filter(r => !r.done && new Date(r.dueAt).getTime() > now - 86400000);
    localStorage.setItem("jannu_reminders", JSON.stringify(savedReminders));
    savedReminders.forEach(scheduleReminder);
    renderDashboard();
}

function scheduleReminder(reminder) {
    const due = new Date(reminder.dueAt).getTime();
    const delay = due - Date.now();
    if (delay <= 0 || reminder.done) return;

    if (reminderTimers.has(reminder.id)) clearTimeout(reminderTimers.get(reminder.id));

    const chunk = Math.min(delay, 2147480000);
    const timer = setTimeout(() => {
        if (Date.now() < due) {
            scheduleReminder(reminder);
            return;
        }
        fireReminder(reminder);
    }, chunk);
    reminderTimers.set(reminder.id, timer);
}

function fireReminder(reminder) {
    reminder.done = true;
    localStorage.setItem("jannu_reminders", JSON.stringify(savedReminders));

    const message = "Reminder: " + reminder.title;
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Jannu Reminder 🔔", {
            body: message,
            icon: "/static/manifest.json"
        });
    } else {
        alert("🔔 " + message);
    }

    appendMessage(message, "ai");
    renderDashboard();
}


function renderDashboard() {
    const pending = savedTasks.filter(t => t.status === "pending");
    const reminderCount = savedReminders.filter(r => !r.done).length;
    document.getElementById("taskCount").innerText = pending.length + reminderCount;
    document.getElementById("tasksList").innerHTML = pending.length === 0
        ? '<li class="empty">No tasks</li>'
        : pending.map(t => '<li>⏳ ' + escapeHtml(t.title) + '</li>').join("");
    document.getElementById("notesList").innerHTML = savedNotes.length === 0
        ? '<li class="empty">No notes</li>'
        : savedNotes.slice(-5).reverse().map(n => '<li>📌 ' + escapeHtml(n) + '</li>').join("");
}

function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function appendMessage(text, sender) {
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("message", sender);
    msgDiv.innerText = text;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}
