// ----------------------
// SOUND ENGINE
// ----------------------
let audioCtx = null;

async function playSound(type) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "bot") {
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    }

    if (type === "user") {
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    }

    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
}

// ----------------------
// STATE VARIABLES
// ----------------------
let step = 0;
let initialIssue = "";
let allDevices = [];
let deviceName = "Unknown device";
let deviceSide = null;
let deviceModel = null;
let deviceVatType = null;
let deviceVatPot = null;
let devicePlaten = null;
let pluggedInCheck = null;
let switchboardCheck = null;
let powerCycleAttempted = null;
let finalOutcome = null;
let attemptedFix = null;
let placedInStandby = null;
let repeatFailure = null;

let issueQueue = [];
let currentIssue = null;

let deviceOutcomes = {};
let config = { knownDevices: [], deviceSpecificFixes: {}, fixExplanations: {}, specializedScenarios: [] };

const introGreetings = [
    "Hi there! I am the Repair & Operations Smart System — but you can call me Ross for short. What’s not working?",
    "Hello! I'm Ross, your Repair & Operations Smart System. How can I help you today?",
    "Hi! Ross here, ready to help with any equipment issues. What's going on?"
];

const followUpGreetings = [
    "Sure thing. What’s your next issue?",
    "No problem. What else is playing up?",
    "Understood. What else can I look into for you?",
    "Got it. What's the next item on the list?"
];

// ----------------------
// FLOW HELPERS
// ----------------------
function isPowerIssue(text) {
    const powerKeywords = [/\bpower\b/i, /\bturn(ing)?\s+on\b/i, /\bwon'?t\s+start\b/i, /\bwon'?t\s+work\b/i, /\bdead\b/i, /\blights\b/i, /\bblank\b/i, /\bno\s+screen\b/i, /\b(turned|switched)\s+off\b/i, /\bno\s+power\b/i, /\bbuttons?\b/i, /\bunresponsive\b/i, /\bfrozen\b/i, /\bkeypad\b/i];
    const lower = text.toLowerCase();
    return powerKeywords.some(pattern => pattern.test(lower));
}

function handleFreezerLockMixFlow(resolved) {
    botMessage("Is this the first fail today?");
    setTimeout(() => showCustomButtons([
        { 
            label: "Yes", 
            action: () => {
                repeatFailure = "No";
                if (resolved) {
                    botMessage("Great. Please put the machine into another heat cycle now.");
                } else {
                    botMessage("Understood. Please adjust the mix levels and try another heat cycle now.");
                }

                setTimeout(() => {
                    botMessage("Did that heat cycle resolve the freezer lock?");
                    setTimeout(() => showCustomButtons([
                        { 
                            label: "Yes", 
                            action: () => {
                                finalOutcome = "Fixed";
                                botMessage("Great work - you fixed it!");
                                step = 99;
                                setTimeout(moveToNextIssueOrFinish, 600);
                            } 
                        },
                        { 
                            label: "No", 
                            action: () => {
                                botMessage("Understood. Please place the machine in standby and eTech the unit.");
                                finalOutcome = "Not fixed";
                                placedInStandby = "Yes";
                                step = 99;
                                setTimeout(moveToNextIssueOrFinish, 600);
                            } 
                        }
                    ]), 600);
                }, 2000);
            } 
        },
        { 
            label: "No", 
            action: () => {
                botMessage("Understood. Please place the machine in standby and eTech the unit so a technician can take a look.");
                finalOutcome = "Not fixed";
                placedInStandby = "Yes";
                repeatFailure = "Yes";
                step = 99;
                setTimeout(moveToNextIssueOrFinish, 2000);
            } 
        }
    ]), 600);
}

function showResolutionButtons() {
    const isFreezerLock = /freezer[-\s]*lock/i.test(initialIssue);
    if (attemptedFix === "Perform Brush Clean" || attemptedFix === "Reset Motor Overload") {
        showCustomButtons([
            { 
                label: "Yes", 
                action: () => {
                    if (isFreezerLock) {
                        handleFreezerLockMixFlow(true);
                    } else {
                        nextStep("fixed_yes");
                    }
                } 
            },
            { label: "No", action: () => {
                finalOutcome = "Not fixed";
                if (isFreezerLock) {
                    handleFreezerLockMixFlow(false);
                } else {
                    botMessage("Understood. Please eTech the unit so a technician can take a look.");
                    step = 99;
                    setTimeout(moveToNextIssueOrFinish, 600);
                }
            }},
            { label: "I don't know how to", action: () => {
                finalOutcome = "Maintenance Required"; 
                placedInStandby = "Yes";
                botMessage("Understood. Please place the machine in standby and organize a trained person to complete this task.");
                step = 99;
                setTimeout(moveToNextIssueOrFinish, 600);
            }}
        ]);
        return;
    }

    if (isFreezerLock) {
        // For Freezer Locks, both Yes and No lead to the "First fail" check
        showCustomButtons([
            { label: "Yes", action: () => handleFreezerLockMixFlow(true) },
            { label: "No", action: () => handleFreezerLockMixFlow(false) }
        ]);
        return;
    }

    showCustomButtons([
        { label: "Yes", action: () => nextStep("fixed_yes") },
        { label: "No", action: () => {
            finalOutcome = "Not fixed";
            if (powerCycleAttempted === null && isPowerIssue(initialIssue)) {
                botMessage("I see. Have you tried turning it off and on again?", true);
                step = 3;
            } else {
                botMessage("Understood. Please eTech it so a technician can take a look.");
                step = 99;
                setTimeout(moveToNextIssueOrFinish, 600);
            }
        }}
    ]);
}

/**
 * Helper to check if a specific device name belongs to a broader category.
 * e.g., "Side 1 Toaster" is a "Toaster", "Taylor C602" is a "Shake Machine".
 */
function isDeviceType(currentName, targetType) {
    if (!currentName || !targetType) return false;
    const name = currentName.toLowerCase();
    const target = targetType.toLowerCase();
    if (name === target || name.includes(target)) return true;
    if (config.deviceAliases[target] && config.deviceAliases[target].includes(name)) return true;
    return false;
}

function triggerCommonFixes() {
    let fixes = config.deviceSpecificFixes[deviceName.toLowerCase()] ? [...config.deviceSpecificFixes[deviceName.toLowerCase()]] : [];

    // Narrow down Shake Machine fixes based on symptom categories
    if (isDeviceType(deviceName, "shake machine")) {
        const freezingKeywords = ["dispensing", "freeze", "freezing", "soft", "runny", "thick", "melted", "liquid", "not freezing"];
        const flavourKeywords = ["flavour", "flavor", "syrup", "taste", "duckbill", "line", "sanitise", "sanitize"];
        
        const isFreezing = freezingKeywords.some(w => initialIssue.toLowerCase().includes(w));
        const isFlavour = flavourKeywords.some(w => initialIssue.toLowerCase().includes(w));

        if (isFreezing) {
            fixes = ["Check Mix Level", "Reset Pump", "Reset Motor Overload", "Clean Air Filter"];
        } else if (isFlavour) {
            fixes = ["Clean Duckbills", "Flush and Sanitise Syrup Lines"];
        } else {
            // If it's a shake machine and we haven't identified a specific category,
            // return false to prevent dumping the entire list of 7+ fixes.
            return false;
        }
    }

    // Conditional logic for Grill cooking issues
    if (isDeviceType(deviceName, "grill")) {
        const cookingKeywords = ["meat", "cook", "raw", "cold", "pink", "temperature", "temp", "quality", "burnt", "undercooked"];
        const isCookingIssue = cookingKeywords.some(word => initialIssue.toLowerCase().includes(word));
        if (isCookingIssue) {
            fixes.push("Scrape Top Platens");
        }
        
        // Only suggest power lead if specifically a power issue and NOT a cooking issue
        if (!isCookingIssue && isPowerIssue(initialIssue)) {
            fixes.push("Check Power Lead");
        }
    }

    // Conditional logic for Vat E82 error
    if (isDeviceType(deviceName, "vat")) {
        if (initialIssue.toLowerCase().includes("e82")) {
            fixes.push("Reset High-Limit Switch");
        }
    }

    if (fixes.length > 0) {
        let displayLabel = deviceName;
        if (devicePlaten) displayLabel = `${deviceSide} - ${devicePlaten}`;
        if (devicePlaten) {
            displayLabel = `${deviceSide} - ${devicePlaten}`;
        } else if (deviceVatType) {
            displayLabel = deviceVatPot ? `${deviceVatType} (${deviceVatPot})` : deviceVatType;
        }
        else if (deviceModel) displayLabel = (deviceSide && deviceSide !== "Single Unit") ? `${deviceModel} (${deviceSide})` : deviceModel;
        else if (deviceSide) displayLabel = (deviceSide.toLowerCase().includes(deviceName.toLowerCase())) ? deviceSide : `${deviceSide} ${deviceName}`;
        
        botMessage(`I'm sorry to hear that. For the ${displayLabel}, here are some common fixes. Have you tried any of these?`);
        setTimeout(() => {
            const buttons = fixes.map(f => ({
                label: f,
                action: () => {
                    attemptedFix = f;
                    const explanation = config.fixExplanations[f];
                    if (explanation) {
                        botMessage(explanation);
                    }
                    
                    setTimeout(() => {
                        const isFreezerLock = /freezer[-\s]*lock/i.test(initialIssue);
                        const question = (f === "Check Mix Level" && isFreezerLock) ? "Are the mix levels correct?" : "Did that resolve the issue?";
                        botMessage(question);
                        step = 4; // Advance to verification step to prevent identification loop
                        setTimeout(showResolutionButtons, 600);
                    }, explanation ? 1200 : 0);
                }
            }));

            buttons.push({
                label: "None of these match my issue",
                action: () => {
                    finalOutcome = "Not fixed";
                    botMessage("Understood. Please eTech it so a technician can take a look.");
                    step = 99;
                    setTimeout(moveToNextIssueOrFinish, 600);
                }
            });

            showCustomButtons(buttons);
        }, 800);
        return true;
    }
    return false;
}

// ----------------------
// TYPING INDICATOR
// ----------------------
function showTyping() {
    const chat = document.getElementById("chat");
    const bubble = document.createElement("div");
    bubble.className = "typing";
    bubble.id = "typingIndicator";

    for (let i = 0; i < 3; i++) {
        const dot = document.createElement("div");
        dot.className = "typing-dot";
        bubble.appendChild(dot);
    }

    chat.appendChild(bubble);
    scrollToBottom();
}

function hideTyping() {
    const t = document.getElementById("typingIndicator");
    if (t) t.remove();
}

// ----------------------
// TIMESTAMPS
// ----------------------
function addTimestamp() {
    const chat = document.getElementById("chat");
    const ts = document.createElement("div");
    ts.className = "timestamp";

    const now = new Date();
    ts.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    chat.appendChild(ts);
}

function scrollToBottom() {
    const chat = document.getElementById("chat");
    chat.scrollTop = chat.scrollHeight;
}

// ----------------------
// SMART TEXT CLEANING
// ----------------------
function cleanInitialIssue(text) {
    let t = text.toLowerCase().trim();

    const greetings = [
        "hi ross","hi","hello","hey","yo","good morning",
        "good afternoon","good evening","i got in this morning",
        "i got in this afternoon","i got in tonight","ross",
        "mate","buddy","team"
    ];
    greetings.forEach(g => t = t.replace(new RegExp("\\b" + g + "\\b", "gi"), "").trim());

    const fillers = [
        "just letting you know","i think","i guess","basically",
        "pretty much","sort of","kind of","like","um","uh",
        "and","but","so","well"
    ];
    fillers.forEach(f => t = t.replace(new RegExp("^" + f + "\\b", "gi"), "").trim());

    t = t.replace(/^[,.\-:; ]+/, "");

    return t.trim();
}

// ----------------------
// ISSUE PHRASE EXTRACTION
// ----------------------
function extractIssuePhrase(text, device) {
    const idx = text.indexOf(device);
    if (idx === -1) return "";

    const after = text.substring(idx + device.length).trim();

    const stopWords = [" and ", " but ", " also ", " plus "];
    let cutIndex = after.length;

    stopWords.forEach(word => {
        const wIdx = after.indexOf(word);
        if (wIdx !== -1 && wIdx < cutIndex) cutIndex = wIdx;
    });

    return after.substring(0, cutIndex).trim();
}

// ----------------------
// FUZZY MATCHING HELPER
// ----------------------
function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// ----------------------
// MULTI‑ISSUE DETECTION
// ----------------------
function extractAllIssues(text) {
    const issues = [];
    const lower = text.toLowerCase();
    let detectionText = lower;

    // Create a combined list of searchable terms (devices + aliases)
    let searchTerms = [];
    config.knownDevices.forEach(d => searchTerms.push({ main: d, search: d }));
    
    if (config.deviceAliases) {
        for (const [main, aliases] of Object.entries(config.deviceAliases)) {
            aliases.forEach(a => searchTerms.push({ main: main, search: a }));
        }
    }

    // Sort by length descending to match longer phrases first (e.g., "side 1 toaster")
    searchTerms.sort((a, b) => b.search.length - a.search.length);

    searchTerms.forEach(item => {
        const pattern = new RegExp("\\b" + item.search.replace(/ /g, "\\s+") + "\\b", "i");
        const match = detectionText.match(pattern);
        
        if (match) {
            issues.push({
                device: item.main,
                phrase: extractIssuePhrase(lower, item.search),
                fullContext: lower
            });
            detectionText = detectionText.replace(pattern, " ".repeat(match[0].length));
        }
    });

    // Deduplicate issues by device. If multiple matches point to the same machine 
    // (e.g., "shake" and "freezer lock"), we treat them as a single issue.
    const uniqueIssues = [];
    const seenDevices = new Set();
    issues.forEach(issue => {
        if (!seenDevices.has(issue.device)) {
            uniqueIssues.push(issue);
            seenDevices.add(issue.device);
        }
    });

    return uniqueIssues;
}

function extractAllDevices(text) {
    const found = [];
    const lower = text.toLowerCase();
    let detectionText = lower;

    const devices = [...config.knownDevices].sort((a, b) => b.length - a.length);

    devices.forEach(d => {
        const pattern = new RegExp("\\b" + d.replace(/ /g, "\\s+") + "\\b", "i");
        const match = detectionText.match(pattern);
        if (match) {
            found.push(d);
            detectionText = detectionText.replace(pattern, " ".repeat(match[0].length));
        }
    });

    // Check aliases
    if (found.length === 0 && config.deviceAliases) {
        for (const [mainName, aliases] of Object.entries(config.deviceAliases)) {
            for (const alias of aliases) {
                const pattern = new RegExp("\\b" + alias.replace(/ /g, "\\s+") + "\\b", "i");
                if (pattern.test(lower)) {
                    found.push(mainName);
                    break;
                }
            }
        }
    }

    // If no exact matches found, try fuzzy matching on individual words
    if (found.length === 0) {
        const words = lower.split(/\s+/);
        for (const word of words) {
            if (word.length < 3) continue; // Skip tiny words
            for (const d of devices) {
                // If edit distance is small relative to word length
                const distance = levenshteinDistance(word, d);
                const threshold = d.length <= 4 ? 1 : 2; 
                
                if (distance <= threshold) {
                    found.push(d);
                    break; 
                }
            }
            if (found.length > 0) break;
        }
    }

    return found.length > 0 ? found : ["Unknown device"];
}

function extractDevice(text) {
    const lower = text.toLowerCase();
    const devices = [...config.knownDevices].sort((a, b) => b.length - a.length);
    
    // 1. Try Exact Matches
    for (let d of devices) {
        const pattern = new RegExp("\\b" + d.replace(/ /g, "\\s+") + "\\b", "i");
        if (pattern.test(lower)) return { name: d, isFuzzy: false };
    }

    // 2. Try Alias Matches (Treat as non-fuzzy exact matches)
    if (config.deviceAliases) {
        for (const [mainName, aliases] of Object.entries(config.deviceAliases)) {
            for (const alias of aliases) {
                const pattern = new RegExp("\\b" + alias.replace(/ /g, "\\s+") + "\\b", "i");
                if (pattern.test(lower)) return { name: mainName, isFuzzy: false };
            }
        }
    }

    // 3. Fuzzy Fallback
    const words = lower.split(/\s+/);
    let fuzzyCandidates = [];

    for (const d of devices) { // d is a known device like "vat", "grill"
        const dThreshold = d.length <= 4 ? 1 : 2; // Apply device-specific threshold
        for (const word of words) { // word is "raw", "meat"
            if (word.length < 3) continue; // Skip tiny words
            const distance = levenshteinDistance(word, d);
            
            if (distance <= dThreshold) { // Only consider if it's within its own threshold
                fuzzyCandidates.push({ device: d, distance: distance });
            }
        }
    }

    if (fuzzyCandidates.length > 0) {
        // Sort candidates by distance, then by device name length (to prefer more specific devices)
        fuzzyCandidates.sort((a, b) => {
            if (a.distance !== b.distance) return a.distance - b.distance;
            return a.device.length - b.device.length; // Prefer shorter device names for same distance
        });
        return { name: fuzzyCandidates[0].device, isFuzzy: true };
    }

    return { name: "Unknown device", isFuzzy: false };
}

function isVague(text) {
    const vague = [
        "broken", "not working", "isn't working", "is not working",
        "something's wrong", "something is wrong", "it stopped",
        "help", "issue", "problem", "won't work", "wont work",
        "cooked", "dead", "kaput", "no good", "done", "mucked up"
    ];
    const lower = text.toLowerCase().trim();
    if (vague.some(v => lower.includes(v))) return true;

    // Return true if the input is just the device name or an alias (no symptom provided)
    if (lower === deviceName.toLowerCase()) return true;
    const aliases = config.deviceAliases[deviceName.toLowerCase()] || [];
    if (aliases.some(a => a.toLowerCase() === lower)) return true;

    return false;
}

// ----------------------
// E‑TECH NOTES (per‑device summary)
// ----------------------
function generateETechNotes() {
    const unresolved = Object.entries(deviceOutcomes).filter(([_, data]) => data.outcome === "Not fixed");
    
    if (unresolved.length === 0) return "";

    let summary = "Device Issue Summary (Technician Required):\n";

    for (const [device, data] of unresolved) {
        summary += `\n${device.toUpperCase()}:\n`;
        if (data.issue) summary += `- Issue: ${data.issue}\n`;
        if (data.pluggedIn) summary += `- Plugged in: ${data.pluggedIn}\n`;
        if (data.switchboard) summary += `- Switchboard: ${data.switchboard}\n`;
        if (data.powerCycle) summary += `- Power cycle: ${data.powerCycle}\n`;
        if (data.attemptedFix) summary += `- Attempted Fix: ${data.attemptedFix}\n`;
        if (data.standby) summary += `- Placed in Standby: ${data.standby}\n`;
        if (data.repeat) summary += `- Repeat failure: ${data.repeat}\n`;
        summary += `- Status: Not fixed (Technician Required)\n`;
    }

    summary += `\n\n`; // Removed photo count
    return summary;
}

function showETechNotes() {
    const notes = generateETechNotes();

    if (notes) {
        botMessage("Troubleshooting was unsuccessful for some items. Here are your eTech notes for the technician:");
        botMessage(notes);
    }
    
    // Ask if there is anything else after showing the summary
    setTimeout(() => {
        botMessage("Is there anything else I can help you with?");
        setTimeout(() => {
            showCustomButtons([
                { label: "Yes", action: () => {
                    document.getElementById("chat").innerHTML = "";
                    resetState();
                    const greeting = followUpGreetings[Math.floor(Math.random() * followUpGreetings.length)];
                    botMessage(greeting);
                }},
                { label: "No", action: () => exitRoss() }
            ]);
        }, 600);
    }, notes ? 2500 : 1000);
}

// ----------------------
// MENU
// ----------------------
function toggleMenu() {
    const menu = document.getElementById("menu");
    menu.classList.toggle("visible");
}

function resetState() {
    step = 0;
    initialIssue = "";
    allDevices = [];
    deviceName = "Unknown device";
    deviceSide = null;
    deviceModel = null;
    deviceVatType = null;
    deviceVatPot = null;
    devicePlaten = null;
    pluggedInCheck = null;
    switchboardCheck = null;
    powerCycleAttempted = null;
    finalOutcome = null;
    attemptedFix = null;
    placedInStandby = null;
    repeatFailure = null;
    issueQueue = [];
    currentIssue = null;
    deviceOutcomes = {};
}

function restartRoss() {
    document.getElementById("chat").innerHTML = "";
    resetState();
    toggleMenu();
    const greeting = introGreetings[Math.floor(Math.random() * introGreetings.length)];
    botMessage(greeting);
}

function exitRoss() {
    document.body.innerHTML = `
        <div style="display:flex; justify-content:center; align-items:center; height:100vh; background:#f5f5f7; font-family:Arial, sans-serif; text-align:center; padding:20px; box-sizing:border-box;">
            <h2 style="color:#d00000;">Thank you for using R.O.S.S.<br><br>You may now close this window.</h2>
        </div>
    `;
}

// ----------------------
// BOT MESSAGE (with typing + buttons below)
// ----------------------
function botMessage(text, withButtons = false) {
    showTyping();

    setTimeout(() => {
        hideTyping();

        const chat = document.getElementById("chat");

        const row = document.createElement("div");
        row.className = "bot-row";

        const avatar = document.createElement("div");
        avatar.className = "bot-avatar";
        avatar.innerText = "🤖";

        const bubble = document.createElement("div");
        bubble.className = "bubble bot";
        bubble.innerText = text;

        row.appendChild(avatar);
        row.appendChild(bubble);
        chat.appendChild(row);
        addTimestamp();
        scrollToBottom();

        if (withButtons) {
            setTimeout(() => {
                addDefaultButtons();
            }, 500);
        }
        playSound("bot");
    }, 450);
}

// ----------------------
// USER MESSAGE
// ----------------------
function userMessage(text) {
    const chat = document.getElementById("chat");
    const bubble = document.createElement("div");
    bubble.className = "bubble user";
    bubble.innerText = text;
    chat.appendChild(bubble);
    addTimestamp();
    scrollToBottom();
    playSound("user");
}

// ----------------------
// QUICK ANSWER BUTTONS (always below bubble)
// ----------------------
function showCustomButtons(buttons) {
    const chat = document.getElementById("chat");

    const row = document.createElement("div");
    row.className = "quick-buttons";

    buttons.forEach(btnDef => {
        const btn = document.createElement("button");
        btn.innerText = btnDef.label;

        btn.onclick = () => {
            row.remove();
            userMessage(btnDef.label);
            btnDef.action();
        };

        row.appendChild(btn);
    });

    chat.appendChild(row);
    scrollToBottom();
}

function addDefaultButtons() {
    setTimeout(() => showCustomButtons([
        { label: "Yes", action: () => nextStep("yes") },
        { label: "No", action: () => nextStep("no") },
        { label: "Not sure", action: () => nextStep("not sure") }
    ]), 50);
}

// ----------------------
// MULTI‑ISSUE SELECTION
// ----------------------
function askWhichIssueFirst() {
    botMessage("I found multiple issues.");

    setTimeout(() => {
        botMessage("Please pick one to start with:");
        
        setTimeout(() => {
            const chat = document.getElementById("chat");
            const row = document.createElement("div");
            row.className = "quick-buttons";

            issueQueue.forEach(issue => {
                const btn = document.createElement("button");
                const labelDevice = issue.device.charAt(0).toUpperCase() + issue.device.slice(1);
                const labelPhrase = issue.phrase ? (" — " + issue.phrase) : "";
                btn.innerText = labelDevice + labelPhrase;

                btn.onclick = () => {
                    row.remove();
                    userMessage(btn.innerText);
                    currentIssue = issue;
                    deviceName = issue.device;
                    initialIssue = issue.phrase || initialIssue;
                    issueQueue = issueQueue.filter(i => i !== issue);
                    setTimeout(() => nextStep(""), 300);
                };
                row.appendChild(btn);
            });
            chat.appendChild(row);
            scrollToBottom();
        }, 550);
    }, 600);
}

// ----------------------
// MOVE TO NEXT ISSUE
// ----------------------
function moveToNextIssueOrFinish() {
    let logName = deviceName;
    if (devicePlaten) logName = `${deviceSide} - ${devicePlaten}`;
    if (devicePlaten) {
        logName = `${deviceSide} - ${devicePlaten}`;
    } else if (deviceVatType) {
        logName = deviceVatPot ? `${deviceVatType} (${deviceVatPot})` : deviceVatType;
    }
    else if (deviceModel) logName = (deviceSide && deviceSide !== "Single Unit") ? `${deviceModel} (${deviceSide})` : deviceModel;
    else if (deviceSide) logName = (deviceSide.toLowerCase().includes(deviceName.toLowerCase())) ? deviceSide : `${deviceSide} ${deviceName}`;

    // Save completed device outcome
    deviceOutcomes[logName] = {
        issue: initialIssue,
        pluggedIn: pluggedInCheck,
        switchboard: switchboardCheck,
        powerCycle: powerCycleAttempted,
        outcome: finalOutcome,
        attemptedFix: attemptedFix,
        side: deviceSide,
        platen: devicePlaten,
        model: deviceModel,
        vatType: deviceVatType,
        vatPot: deviceVatPot,
        standby: placedInStandby,
        repeat: repeatFailure
    };

    if (issueQueue.length > 0) {
        const next = issueQueue.shift();
        currentIssue = next;
        deviceName = next.device;
        initialIssue = next.phrase || initialIssue;

        step = 0;
        deviceSide = null;
        deviceModel = null;
        deviceVatType = null;
        deviceVatPot = null;
        devicePlaten = null;
        pluggedInCheck = null;
        switchboardCheck = null;
        powerCycleAttempted = null;
        attemptedFix = null;
        finalOutcome = null;
        placedInStandby = null;
        repeatFailure = null;

        botMessage("Alright, next issue: " + next.device);

        setTimeout(() => nextStep(""), 800);

    } else {
        showETechNotes();
    }
}

// ----------------------
// MAIN TROUBLESHOOTING FLOW
// ----------------------
function askShakeSymptom() {
    botMessage("To help me narrow it down, what's the main symptom?");
    setTimeout(() => {
        showCustomButtons([
            { label: "Dispensing Issue / Not Freezing", action: () => { initialIssue = "dispensing"; nextStep("narrowed"); } },
            { label: "Error Code on screen", action: () => { initialIssue = "error"; nextStep("narrowed"); } },
            { label: "Flavour / Syrup issue", action: () => { initialIssue = "flavour"; nextStep("narrowed"); } },
            { label: "Machine is locked out", action: () => { initialIssue = "lockout"; nextStep("narrowed"); } }
        ]);
    }, 600);
}

function nextStep(response) {

    // STEP 0 — Device logged
    if (step === 0) {
        const lowerDevice = deviceName.toLowerCase();
        const context = (currentIssue?.fullContext || initialIssue || "").toLowerCase();
        const isGenericToaster = lowerDevice === "toaster" || lowerDevice === "bun toaster";

        // 1. Grill Flow: Confirm Left/Right and Whole/Platen
        if (lowerDevice === "grill" && !devicePlaten) {
            // Check for explicit platen mention
            const platenMatch = context.match(/\bplaten\s*([1-6])\b/i);
            if (platenMatch) {
                const num = parseInt(platenMatch[1]);
                devicePlaten = "Platen " + num;
                deviceSide = (num <= 3) ? "Left Grill" : "Right Grill";
            } 
            // Check for side mention if platen not found
            else if (!deviceSide) {
                if (/\bleft\b/i.test(context)) deviceSide = "Left Grill";
                else if (/\bright\b/i.test(context)) deviceSide = "Right Grill";
            }

            if (!deviceSide) {
                botMessage("Which grill is having the issue?");
                setTimeout(() => {
                    showCustomButtons([
                        { label: "Left Grill (Platens 1-3)", action: () => { deviceSide = "Left Grill"; nextStep(""); } },
                        { label: "Right Grill (Platens 4-6)", action: () => { deviceSide = "Right Grill"; nextStep(""); } }
                    ]);
                }, 600);
                return;
            }

            if (!devicePlaten) {
                const platens = (deviceSide === "Left Grill") ? ["1", "2", "3"] : ["4", "5", "6"];
                botMessage(`Is it the whole ${deviceSide} or a particular platen?`);
                const buttons = [
                    { label: "Whole Grill", action: () => { devicePlaten = "Whole Grill"; nextStep(""); } }
                ];
                platens.forEach(p => {
                    buttons.push({ label: "Platen " + p, action: () => { devicePlaten = "Platen " + p; nextStep(""); } });
                });
                buttons.push({ label: "⬅️ Back", action: () => { deviceSide = null; nextStep(""); } }); // Back button
                setTimeout(() => showCustomButtons(buttons), 600);
                return;
            }
        }

        // 2. Muffin Toaster Selection (Top/Bottom)
        if (lowerDevice.includes("muffin") && !deviceSide) {
            if (/\btop\b/i.test(context)) deviceSide = "Top";
            else if (/\bbottom\b/i.test(context)) deviceSide = "Bottom";
            if (!deviceSide) {
                botMessage("Which muffin toaster is it?");
                setTimeout(() => {
                    showCustomButtons([
                        { label: "Top", action: () => { deviceSide = "Top"; nextStep(""); } },
                        { label: "Bottom", action: () => { deviceSide = "Bottom"; nextStep(""); } }
                    ]);
                }, 600);
                return;
            }
        }

        // 3. Toaster Logic (Handle generic identification)
        if (isGenericToaster && !deviceSide && response !== "select_mfy") {
            botMessage("What type of toaster is it?");
            setTimeout(() => {
                showCustomButtons([
                    { label: "MFY Toaster (Side 1-4)", action: () => { nextStep("select_mfy"); } },
                    { label: "Muffin Toaster", action: () => { deviceName = "Muffin Toaster"; nextStep(""); } },
                    { label: "Press / Cafe Toaster", action: () => { deviceName = "Press Toaster"; nextStep(""); } }
                ]);
            }, 600);
            return;
        }

        // 4. Side Selection for MFY Toasters
        const isMFY = (lowerDevice.includes("side") && lowerDevice.includes("toaster")) || response === "select_mfy";
        if (isMFY && !deviceSide) {
            if (/\bside\s*1\b/i.test(context)) deviceSide = "Side 1";
            else if (/\bside\s*2\b/i.test(context)) deviceSide = "Side 2";
            else if (/\bside\s*3\b/i.test(context)) deviceSide = "Side 3";
            else if (/\bside\s*4\b/i.test(context)) deviceSide = "Side 4";
            
            if (!deviceSide) {
                botMessage("Which MFY side toaster is it?");
                setTimeout(() => {
                    showCustomButtons([
                        { label: "Side 1", action: () => { deviceName = "Side 1 Toaster"; deviceSide = "Side 1"; nextStep(""); } },
                        { label: "Side 2", action: () => { deviceName = "Side 2 Toaster"; deviceSide = "Side 2"; nextStep(""); } },
                        { label: "Side 3", action: () => { deviceName = "Side 3 Toaster"; deviceSide = "Side 3"; nextStep(""); } },
                        { label: "Side 4", action: () => { deviceName = "Side 4 Toaster"; deviceSide = "Side 4"; nextStep(""); } }
                    ]);
                }, 600);
                return;
            }
            // Normalize name based on side for mapping to config
            if (!deviceName.toLowerCase().includes("side")) {
                deviceName = deviceSide.toLowerCase() + " toaster";
            }
        }

        // 5. Shake Machine Flow: Identification of Model and Numbering
        if (lowerDevice.includes("shake") && !deviceModel) {
            if (context.includes("taylor") || context.includes("c602")) deviceModel = "Taylor C602";
            else if (context.includes("carpigiani") || context.includes("k3")) deviceModel = "Carpigiani K3";

            if (!deviceModel) {
                botMessage("Which shake / sundae machine is it?");
                setTimeout(() => {
                    showCustomButtons([
                        { label: "Taylor C602", action: () => { deviceModel = "Taylor C602"; nextStep(""); } },
                        { label: "Carpigiani K3 (Shake/Sundae)", action: () => { deviceModel = "Carpigiani K3"; nextStep(""); } }
                    ]);
                }, 600);
                return;
            }
        }

        if (deviceModel === "Taylor C602" && !deviceSide) {
            const numMatch = context.match(/\b(?:machine|number|no|#|shake)\s*([12])\b/i) || context.match(/\b([12])\b/);
            if (numMatch) deviceSide = "Machine " + numMatch[1];

            if (!deviceSide) {
                if (/\bleft\b/i.test(context)) deviceSide = "Machine 1";
                else if (/\bright\b/i.test(context)) deviceSide = "Machine 2";
            }

            if (!deviceSide) {
                botMessage("Is it Shake Machine 1 or 2?");
                setTimeout(() => {
                    showCustomButtons([
                        { label: "Machine 1", action: () => { deviceSide = "Machine 1"; nextStep(""); } },
                        { label: "Machine 2", action: () => { deviceSide = "Machine 2"; nextStep(""); } },
                        { label: "We only have one", action: () => { deviceSide = "Single Unit"; nextStep(""); } }
                    ]);
                }, 600);
                return;
            }
        }

        // 6. Vat / Fryer Flow: Identification of Model
        if (isDeviceType(deviceName, "vat") && !deviceModel) {
            if (context.includes("henny penny") || context.includes("lve")) {
                if (context.includes("100")) deviceModel = "Henny Penny LVE 100";
                else if (context.includes("200")) deviceModel = "Henny Penny LVE 200";
                else deviceModel = "Henny Penny LVE";
            }
            else if (context.includes("frymaster") || context.includes("biela14")) deviceModel = "Frymaster BIELA14";

            if (!deviceModel) {
                botMessage("Which model of fryer is it?");
                setTimeout(() => {
                    showCustomButtons([
                        { label: "Henny Penny LVE 100", action: () => { deviceName = "Henny Penny LVE 100"; deviceModel = "Henny Penny LVE 100"; nextStep(""); } },
                        { label: "Henny Penny LVE 200", action: () => { deviceName = "Henny Penny LVE 200"; deviceModel = "Henny Penny LVE 200"; nextStep(""); } },
                        { label: "Frymaster BIELA14", action: () => { deviceName = "Frymaster BIELA14"; deviceModel = "Frymaster BIELA14"; nextStep(""); } },
                        { label: "Not sure", action: () => {
                            botMessage("No worries! You can usually find the model number on a sticker inside the vat doors. Please have a look or ask someone who knows, then let me know.");
                        }}
                    ]);
                }, 600);
                return;
            } else {
                deviceName = deviceModel;
            }
        }

        if (isDeviceType(deviceName, "vat") && !deviceVatPot) {
            // Identify Type (Fry vs Chicken/Fish)
            if (!deviceVatType) {
                if (context.includes("fry vat")) deviceVatType = "Fry Vat";
                else if (context.includes("chick") || context.includes("fish")) deviceVatType = "Chicken/Fish Vat";

                if (!deviceVatType) {
                    botMessage("Is this a Fry Vat or a Chicken/Fish Vat?");
                    setTimeout(() => {
                        showCustomButtons([
                            { label: "Fry Vat", action: () => { deviceVatType = "Fry Vat"; nextStep(""); } },
                            { label: "Chicken/Fish Vat", action: () => { deviceVatType = "Chicken/Fish Vat"; nextStep(""); } }
                        ]);
                    }, 600);
                    return;
                }
            }

            // 3. Determine Whole Unit vs Pot
            const potMatch = context.match(/\bpot\s*([1-8])\b/i);
            if (potMatch) {
                deviceVatPot = "Pot " + potMatch[1];
            } else if (context.includes("whole")) {
                deviceVatPot = "Whole Unit";
            }

            if (!deviceVatPot) {
                botMessage(`Is the issue with the whole ${deviceVatType} or an individual pot?`);
                setTimeout(() => {
                    showCustomButtons([
                        { label: "Whole Unit", action: () => { deviceVatPot = "Whole Unit"; nextStep(""); } },
                        { label: "Individual Pot", action: () => { nextStep("select_pot"); } }
                    ]);
                }, 600);
                return;
            }
        }

        let displayLabel = deviceName;
        if (devicePlaten) displayLabel = `${deviceSide} - ${devicePlaten}`;
        if (devicePlaten) {
            displayLabel = `${deviceSide} - ${devicePlaten}`;
        } else if (deviceVatType) {
            displayLabel = deviceVatPot ? `${deviceVatType} (${deviceVatPot})` : deviceVatType;
        }
        else if (deviceModel) displayLabel = (deviceSide && deviceSide !== "Single Unit") ? `${deviceModel} (${deviceSide})` : deviceModel;
        else if (deviceSide) displayLabel = (deviceSide.toLowerCase().includes(deviceName.toLowerCase())) ? deviceSide : `${deviceSide} ${deviceName}`;

        if (response === "") {
            botMessage('Thanks. I have logged this as: "' + displayLabel + '".');
        }

        // Narrow the flow for Shake Machines if the issue is vague
        if ((lowerDevice.includes("shake") || (deviceModel && deviceModel.toLowerCase().includes("c602"))) && isVague(initialIssue)) {
            setTimeout(askShakeSymptom, 600);
            return;
        }

        // Check for specialized fast-track scenarios
        for (const scenario of config.specializedScenarios) {
            const deviceMatch = isDeviceType(deviceName, scenario.device);
            const patternMatch = new RegExp(scenario.pattern, "i").test(initialIssue);
            
            if (deviceMatch && patternMatch) {
                step = 4; // Advance state to prevent identification loop
                setTimeout(() => {
                    botMessage(scenario.message);
                    setTimeout(() => {
                        if (scenario.fix) {
                            attemptedFix = scenario.fix;
                            botMessage(config.fixExplanations[scenario.fix]);
                            setTimeout(() => {
                                const isFreezerLock = /freezer[-\s]*lock/i.test(initialIssue);
                                const question = (scenario.fix === "Check Mix Level" && isFreezerLock) ? "Are the mix levels correct?" : "Did that resolve the issue?";
                                botMessage(question);
                                setTimeout(showResolutionButtons, 600);
                            }, 1200);
                        } else if (scenario.options) {
                            botMessage("Which of these would you like to check first?");
                            const buttons = scenario.options.map(opt => ({
                                label: opt,
                                action: () => {
                                    attemptedFix = opt;
                                    botMessage(config.fixExplanations[opt]);
                                    setTimeout(() => {
                                        const isFreezerLock = /freezer[-\s]*lock/i.test(initialIssue);
                                        const question = (opt === "Check Mix Level" && isFreezerLock) ? "Are the mix levels correct?" : "Did that resolve the issue?";
                                        botMessage(question);
                                        setTimeout(showResolutionButtons, 600);
                                    }, 1200);
                                }
                            }));
                            buttons.push({ 
                                label: "Neither worked", 
                                action: () => {
                                    finalOutcome = "Not fixed";
                                    botMessage("Understood. Please eTech it so a technician can take a look.");
                                    step = 99;
                                    setTimeout(moveToNextIssueOrFinish, 600);
                                } 
                            });
                            setTimeout(() => showCustomButtons(buttons), 800);
                        }
                    }, 800);
                }, 600);
                return;
            }
        }

        // Check for Power Issue vs Device Specific Issue
        if (isPowerIssue(initialIssue)) {
        setTimeout(() => {
            botMessage("First up - is it plugged in?", true);
            step = 1;
        }, 600);
        } else {
            // Non-power issue: Try common fixes first
            setTimeout(() => {
                const foundFixes = triggerCommonFixes();
                if (!foundFixes) {
                    let label = deviceName;
                    if (devicePlaten) label = `${deviceSide} - ${devicePlaten}`;
                    else if (deviceModel) label = (deviceSide && deviceSide !== "Single Unit") ? `${deviceModel} (${deviceSide})` : deviceModel;
                    else if (deviceSide) label = (deviceSide.toLowerCase().includes(deviceName.toLowerCase())) ? deviceSide : `${deviceSide} ${deviceName}`;

                    if (isDeviceType(deviceName, "shake machine")) {
                        askShakeSymptom();
                        return;
                    }

                    botMessage(`I don't have specific troubleshooting for this issue on the ${label} yet.`);

                    if (powerCycleAttempted === null && isPowerIssue(initialIssue)) {
                        setTimeout(() => {
                            botMessage("Have you tried turning it off and on again?", true);
                            step = 3;
                        }, 600);
                    } else {
                        finalOutcome = "Not fixed";
                        setTimeout(() => {
                            botMessage("Please eTech it so a technician can take a look.");
                            setTimeout(() => {
                                step = 99;
                                moveToNextIssueOrFinish();
                            }, 600);
                        }, 600);
                    }
                }
            }, 600);
        }

        return;
    }

    // STEP 1 — Plugged in?
    if (step === 1) {
        pluggedInCheck = response;

        if (response === "no") {
            botMessage("Please plug it in and try again.");
            setTimeout(() => showCustomButtons([
                { label: "Fixed it", action: () => { 
                    finalOutcome = "Fixed"; 
                    botMessage("Great work - you fixed it!"); 
                    step = 99; 
                    moveToNextIssueOrFinish(); 
                }},
                { label: "Still not working", action: () => { 
                    botMessage("Has the switchboard tripped?", true); 
                    step = 2; 
                }}
            ]), 600);
            return;
        }

        if (response === "not sure") {
            botMessage("Okay, have a look and make sure it is plugged in.");
            setTimeout(() => showCustomButtons([
                { label: "It's plugged in", action: () => { pluggedInCheck = "yes"; botMessage("Has the switchboard tripped?", true); step = 2; }}
            ]), 600);
            return;
        }

        botMessage("Has the switchboard tripped?", true);
        step = 2;
        return;
    }

    // STEP 2 — Switchboard?
    if (step === 2) {
        switchboardCheck = response;

        // NOT SURE
        if (response === "not sure") {
            botMessage("Okay, please check the switchboard and make sure it has not tripped.");
            setTimeout(() => showCustomButtons([
                { label: "It has tripped", action: () => nextStep("yes") },
                { label: "It hasn't tripped", action: () => nextStep("no") }
            ]), 600);
            return;
        }

        // YES - Tripped
        if (response === "yes") {
            switchboardCheck = "yes";
            botMessage("Okay, please reset the breaker and check the equipment again.");
            setTimeout(() => showCustomButtons([
                { label: "Fixed it", action: () => {
                    finalOutcome = "Fixed";
                    botMessage("Great work - you fixed it!");
                    step = 99;
                    moveToNextIssueOrFinish();
                }},
                { label: "Still not working", action: () => {
                    botMessage("Have you tried turning it off and on again?", true);
                    step = 3;
                }}
            ]), 600);
            return;
        }

        // NO - Not Tripped
        if (response === "no") {
            switchboardCheck = "no";
            botMessage("Have you tried turning it off and on again?", true);
            step = 3;
            return;
        }
    }

    // STEP 3 — Power cycle
    if (step === 3) {

        if (response === "yes") {
            powerCycleAttempted = "Yes";
            botMessage("Okay, did that fix the issue?");
            setTimeout(() => showCustomButtons([
                { label: "Yes", action: () => nextStep("fixed_yes") },
                { label: "No", action: () => nextStep("fixed_no") }
            ]), 600);
            step = 4;
            return;
        }

        if (response === "no") {
            powerCycleAttempted = "No";
            botMessage("Please try turning it off and on for me. Did that fix the issue?");
            setTimeout(() => showCustomButtons([
                { label: "Yes", action: () => nextStep("fixed_yes") },
                { label: "No", action: () => nextStep("fixed_no") }
            ]), 600);
            step = 4;
            return;
        }
    }

    // STEP 4 — Final outcome
    if (step === 4) {

        if (response === "fixed_yes") {
            finalOutcome = "Fixed";
            botMessage("Great work - you fixed it!");
            step = 99;
            moveToNextIssueOrFinish();
            return;
        }

        if (response === "fixed_no") {
            if (triggerCommonFixes()) {
                return;
            }

            finalOutcome = "Not fixed";
        if (powerCycleAttempted === null && isPowerIssue(initialIssue)) {
                botMessage("I see. Have you tried turning it off and on again?", true);
                step = 3;
            } else {
                botMessage("Please eTech it so a technician can take a look.");
                setTimeout(() => {
                    step = 99;
                    moveToNextIssueOrFinish();
                }, 600);
            }
            return;
        }
    }
}

// ----------------------
// USER INPUT HANDLER
// ----------------------
document.getElementById("userInput").addEventListener("keydown", function(e) {
    if (e.key === "Enter" && this.value.trim() !== "") {
        const text = this.value.trim();
        this.value = "";

        userMessage(text);

        let shouldAdvance = true;

        if (step === 0) {
            const cleaned = cleanInitialIssue(text);
            const issues = extractAllIssues(cleaned);

            if (issues.length === 0) {
                // Always accumulate the cleaned text into initialIssue
                // This ensures all context is kept for symptom detection
                initialIssue = (initialIssue + " " + cleaned).trim();
                const result = extractDevice(initialIssue);
                deviceName = result.name;
                allDevices = extractAllDevices(initialIssue);

                if (isVague(initialIssue) || deviceName === "Unknown device") {
                    botMessage("No worries — which device is having the issue?");
                    shouldAdvance = false;
                } else if (result.isFuzzy) {
                    // Only show confirmation if it was a fuzzy guess, NOT an alias
                    botMessage(`I think you're talking about the ${deviceName}. Is that right?`);
                    setTimeout(() => showCustomButtons([
                        { label: "Yes", action: () => { nextStep(""); }},
                        { label: "No, something else", action: () => { 
                            resetState(); 
                            botMessage("My apologies. Which device are you having trouble with?"); 
                        }}
                    ]), 600);
                    shouldAdvance = false;
                }
            }

            else if (issues.length === 1) {
                currentIssue = issues[0];
                deviceName = currentIssue.device;
                // Preserve symptoms context and trim. If an issue was matched (even via alias), 
                // extractAllIssues treats it as confident.
                initialIssue = (currentIssue.phrase || (initialIssue ? initialIssue : cleaned)).trim();
                allDevices = extractAllDevices(cleaned);
            }

            else {
                issueQueue = issues.slice();
                allDevices = issues.map(i => i.device);
                initialIssue = cleaned;
                // Preserve symptoms context for multiple issues
                initialIssue = (initialIssue ? initialIssue : cleaned).trim();
                askWhichIssueFirst();
                shouldAdvance = false;
            }
        }

        if (shouldAdvance) {
            setTimeout(() => nextStep(""), 300);
        }
    }
});

// ----------------------
// INITIAL GREETING
// ----------------------
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        config = await response.json();
    } catch (e) { console.error("Failed to load config", e); }
}

window.addEventListener("load", async () => {
    await loadConfig();
    const greeting = introGreetings[Math.floor(Math.random() * introGreetings.length)];
    botMessage(greeting);
});