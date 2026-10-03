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
const moreBtn = document.getElementById("moreBtn");
const detailsPanel = document.getElementById("detailsPanel");
if (moreBtn) moreBtn.addEventListener("click", () => {
    const open = detailsPanel.classList.toggle("open");
    moreBtn.innerText = open ? "⌃ Hide Activity, Reminders & Tasks" : "⌄ Show Activity, Reminders & Tasks";
});

let savedTasks = JSON.parse(localStorage.getItem("ai_tasks") || "[]");
let savedNotes = JSON.parse(localStorage.getItem("ai_notes") || "[]");
let savedActivity = JSON.parse(localStorage.getItem("jannu_activity") || "[]");

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
        addActivity(transcript, "user");

        try {
            if (isTaskRequest(transcript)) {
                const task = createTaskFromSpeech(transcript);
                if (task) {
                    appendMessage("Seri sir, task noted: " + task.title, "ai");
                    addActivity(task.title, "task", task.status);
                    await speakAndResume(await makeSpeech("Seri sir, task noted: " + task.title));
                    return;
                }
            }

            if (isTaskCompletionRequest(transcript)) {
                const completed = completeTaskFromSpeech(transcript);
                if (completed) {
                    appendMessage("Seri sir, task completed: " + completed.title, "ai");
                    addActivity(completed.title, "task", "completed");
                    await speakAndResume(await makeSpeech("Seri sir, task completed: " + completed.title));
                    return;
                }
            }

            if (isReminderRequest(transcript)) {
                const reminderResponse = await fetch("/api/reminder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: transcript })
                });
                const reminderData = await reminderResponse.json();
                appendMessage(reminderData.message || "Reminder set panna mudiyala.", "ai");
                addActivity(reminderData.message || transcript, "reminder");
                if (reminderData.ok) {
                    saveAndScheduleReminder(reminderData.title, reminderData.due_at);
                    addActivity(reminderData.title, "reminder", "pending");
                }
                await speakAndResume(reminderData.audio_b64 || "");
                return;
            }

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: transcript })
            });
            const data = await response.json();
            appendMessage(data.response_text || "Sorry sir, answer kedaikala.", "ai");
            addActivity(data.response_text || "Jannu replied", "ai");
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


function isTaskRequest(text) {
    return /\b(add|create|make|set|note|remember)\b.*\btask\b|\btask\b.*\b(add|create|set|note)\b/i.test(text);
}

function isTaskCompletionRequest(text) {
    return /\b(completed|complete|finished|done)\b.*\b(task|it)\b|\b(task|it)\b.*\b(completed|complete|finished|done)\b/i.test(text);
}

function createTaskFromSpeech(text) {
    let title = text
        .replace(/^.*?\btask\b\s*(to|:|-)?\s*/i, "")
        .replace(/^\s*(add|create|set|note)\s+/i, "")
        .trim();
    if (!title || title.length < 2) title = text.replace(/\b(task|please|add|create|set)\b/gi, "").trim();
    if (!title) return null;
    const task = { id: crypto.randomUUID(), title, status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    savedTasks.unshift(task);
    localStorage.setItem("ai_tasks", JSON.stringify(savedTasks));
    renderDashboard();
    return task;
}

function completeTaskFromSpeech(text) {
    const active = savedTasks.filter(t => t.status === "pending");
    if (!active.length) return null;
    const words = text.toLowerCase().replace(/\b(completed|complete|finished|done|task|it|is|the)\b/g, "").trim();
    let task = active.find(t => words && t.title.toLowerCase().includes(words));
    if (!task) task = active[0];
    task.status = "completed";
    task.updatedAt = new Date().toISOString();
    localStorage.setItem("ai_tasks", JSON.stringify(savedTasks));
    renderDashboard();
    return task;
}

function addActivity(text, type = "message", status = "") {
    savedActivity.unshift({
        id: crypto.randomUUID(),
        text: String(text),
        type,
        status,
        time: new Date().toISOString()
    });
    savedActivity = savedActivity.slice(0, 50);
    localStorage.setItem("jannu_activity", JSON.stringify(savedActivity));
    renderDashboard();
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
    addActivity(message, "reminder", "completed");
    renderDashboard();
}


function renderDashboard() {
    const pending = savedTasks.filter(t => t.status === "pending");
    const reminders = savedReminders.filter(r => !r.done);

    document.getElementById("taskCount").innerText = savedTasks.length;
    document.getElementById("reminderCount").innerText = reminders.length;
    document.getElementById("activityCount").innerText = savedActivity.length;

    document.getElementById("tasksList").innerHTML = savedTasks.length === 0
        ? '<li class="empty">No tasks</li>'
        : savedTasks.map(t => '<li class="task-item ' + t.status + '"><span>' +
          (t.status === "completed" ? "☑️ " : "⬜ ") + escapeHtml(t.title) +
          '</span><small>' + (t.status === "completed" ? "Completed" : "Not completed") + '</small></li>').join("");

    document.getElementById("remindersList").innerHTML = reminders.length === 0
        ? '<li class="empty">No reminders</li>'
        : reminders.map(r => '<li class="reminder-item"><span>🔔 ' + escapeHtml(r.title) +
          '</span><small>' + new Date(r.dueAt).toLocaleString("en-IN", {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) +
          '</small></li>').join("");

    document.getElementById("notesList").innerHTML = savedNotes.length === 0
        ? '<li class="empty">No notes</li>'
        : savedNotes.slice().reverse().slice(0, 10).map(n => '<li>📌 ' + escapeHtml(n) + '</li>').join("");

    document.getElementById("activityList").innerHTML = savedActivity.length === 0
        ? '<div class="empty">No activity yet</div>'
        : savedActivity.map(a => '<div class="activity-row ' + escapeHtml(a.type) + '"><div><span class="activity-dot"></span><span>' +
          escapeHtml(a.text) + '</span></div><small>' +
          new Date(a.time).toLocaleString("en-IN", {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) +
          '</small></div>').join("");
}

