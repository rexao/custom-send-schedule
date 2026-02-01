// Gmail Custom Schedule Content Script

let presets = [];

// Utilities for Date Calculation
function getNextDay(dayOfWeek) {
    const d = new Date();
    d.setDate(d.getDate() + ((dayOfWeek + 7 - d.getDay()) % 7));
    if (d <= new Date()) { // If today is the day and time passed, or just today, maybe move to next week
        d.setDate(d.getDate() + 7);
    }
    return d;
}

function calculateTargetDate(preset) {
    const now = new Date();
    let target = new Date();

    // Handle Date
    if (preset.dayType === 'tomorrow') {
        target.setDate(now.getDate() + 1);
    } else if (preset.dayType === 'nextWeek') {
        // Next Monday
        target.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
    } else if (preset.dayType === 'customDays') {
        target.setDate(now.getDate() + (preset.daysOffset || 1));
    } else if (preset.dayType === 'nextDay') {
        // 0 = Sunday, 1 = Monday
        let daysToAdd = (preset.targetDay + 7 - now.getDay()) % 7;
        if (daysToAdd === 0) daysToAdd = 7; // Next occurrence, not today
        target.setDate(now.getDate() + daysToAdd);
    }

    // Handle Time
    if (preset.time) {
        const [hours, minutes] = preset.time.split(':').map(Number);
        target.setHours(hours, minutes, 0, 0);
    }

    return target;
}

// Load presets
function loadPresets() {
    chrome.storage.sync.get({
        presets: [
            { label: "Tomorrow Morning", dayType: "tomorrow", time: "08:00" },
            { label: "Tomorrow Afternoon", dayType: "tomorrow", time: "13:00" },
            { label: "Monday Morning", dayType: "nextWeek", time: "08:00" }
        ]
    }, function (items) {
        presets = items.presets;
    });
}

// Watch for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.presets) {
        presets = changes.presets.newValue;
    }
});

// Initialization
console.log("Gmail Custom Schedule: Script loaded");
loadPresets();

// Polling for the menu (more robust than Observer for initial debugging)
setInterval(checkForScheduleMenu, 1000);

function checkForScheduleMenu() {
    // Strategy: Look for menu items that have the specific structure of Schedule Send options.
    // User provided structure: <div class="Az" role="menuitem"><div class="Aj">Label</div><div class="Ay">Time</div></div>

    // 1. Find all potential menu items
    const menuItems = document.querySelectorAll('div[role="menuitem"]');

    for (const item of menuItems) {
        // 2. Check if this item looks like a "Schedule Send" preset (Tomorrow, Afternoon, etc.)
        // It should have children with specific class signatures or just exactly 2 children for Label and Time.
        // We look for 'Aj' and 'Ay' classes based on user feedback, but let's be slightly loose if those change, 
        // checking for 2 divs is a good proxy, or checking if the parent contains multiple such items.

        const hasStructure = item.querySelector('.Aj') && item.querySelector('.Ay');

        if (hasStructure) {
            // This item is likely a schedule preset.
            // The menu container is the parent.
            const menuContainer = item.parentElement;

            if (menuContainer && !menuContainer.getAttribute('data-custom-scheduled-injected')) {
                // To be safe, ensure this menu contains at least 2 or 3 such items (standard Schedule send has 3: Tomorrow morning, afternoon, Monday morning)
                // And the last item is "Pick date & time".

                // Let's count siblings with similar structure
                const siblings = menuContainer.querySelectorAll('div[role="menuitem"]');
                if (siblings.length >= 2) {
                    console.log("Gmail Custom Schedule: Found Schedule Menu via structure", menuContainer);
                    menuContainer.setAttribute('data-custom-scheduled-injected', 'true');

                    // We want to inject before the LAST item (which is usually "Pick date & time")
                    const lastItem = siblings[siblings.length - 1];
                    injectCustomItems(menuContainer, lastItem, item); // Pass 'item' as a template for cloning
                    return;
                }
            }
        }
    }
}

function injectCustomItems(menuContainer, refElementForInsertion, templateElement) {
    console.log("Gmail Custom Schedule: Injecting items...");

    // Create separator
    const separator = document.createElement('div');
    separator.style.borderTop = '1px solid #e0e0e0';
    separator.style.margin = '4px 0';
    menuContainer.insertBefore(separator, refElementForInsertion);

    presets.forEach(preset => {
        const item = createMenuItem(preset, templateElement);
        menuContainer.insertBefore(item, refElementForInsertion);
    });
}

function createMenuItem(preset, templateElement) {
    // Clone the template to match styles exactly (classes Az, Aj, Ay usually)
    const item = templateElement.cloneNode(true);

    // Update content
    // We expect: <div class="Aj">Label</div><div class="Ay">Time</div>
    const labelNode = item.querySelector('.Aj');
    const timeNode = item.querySelector('.Ay');

    if (labelNode) labelNode.textContent = preset.label;
    if (timeNode) timeNode.textContent = formatTime(preset);

    // Attach Click Listener
    item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Visual feedback (simple)
        item.style.backgroundColor = 'rgba(0,0,0,0.1)';
        setTimeout(() => item.style.backgroundColor = '', 200);

        // We need the "Pick date & time" item to trigger the modal.
        // It is exactly the last sibling in the current menu usually.
        const siblings = item.parentElement.querySelectorAll('div[role="menuitem"]');
        const pickDateItem = siblings[siblings.length - 1]; // Assuming it's the last one

        if (pickDateItem) {
            handlePresetClick(preset, pickDateItem);
        } else {
            console.error("Gmail Custom Schedule: Could not find Pick Date item to click");
        }
    });

    // Add a marker class
    item.classList.add('custom-schedule-item');
    return item;
}

function formatTime(preset) {
    const d = calculateTargetDate(preset);
    // Use the page's language setting (Gmail sets <html lang="...">)
    // This ensures it matches the UI language (e.g., 'en', 'ja', 'es')
    const locale = document.documentElement.lang || window.navigator.language;
    return d.toLocaleString(locale, { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

async function handlePresetClick(preset, originalPickDateItem) {
    // 1. Calculate Target Date
    const targetDate = calculateTargetDate(preset);

    // 2. Click the original "Pick date & time" to open the modal
    originalPickDateItem.click();

    // 3. Wait for the modal
    const modal = await waitForModal();
    if (!modal) {
        console.error("Gmail Custom Schedule: Modal not found");
        return;
    }

    // 4. Fill inputs
    await fillModal(modal, targetDate);
}

function waitForModal() {
    return new Promise(resolve => {
        let attempts = 0;
        const int = setInterval(() => {
            attempts++;
            // The modal title is "Pick date & time" or localized equivalent.
            // Since we don't know the localized string, we look for the dialog role structure
            // Or look for a visible dialog that just appeared.

            const dialogs = document.querySelectorAll('div[role="dialog"]');
            for (const dialog of dialogs) {
                if (dialog.offsetWidth > 0 && dialog.offsetHeight > 0) {
                    // Check if it has date inputs. 
                    // Usually inputs with type="text"
                    if (dialog.querySelectorAll('input[type="text"]').length >= 2) {
                        clearInterval(int);
                        resolve(dialog);
                        return;
                    }
                }
            }

            if (attempts > 30) {
                clearInterval(int);
                resolve(null);
            }
        }, 100);
    });
}

async function fillModal(modal, date) {
    console.log("Gmail Custom Schedule: Filling modal...", date);

    // There are usually two inputs: Date and Time.
    const inputs = modal.querySelectorAll('input[type="text"]');
    if (inputs.length < 2) return;

    const dateInput = inputs[0];
    const timeInput = inputs[1];

    // Format Date/Time based on user's locale (implied by browser)
    // IMPORTANT: Gmail often expects specific formats or behaves weirdly if we just paste.
    // However, simulating input usually triggers its own parsing.
    // We should try a standard format or rely on the fact that inputting is like typing.

    // Basic approach: Locale string
    // If Japanese: 2026/02/13
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    await simulateInput(dateInput, dateStr);
    await simulateInput(timeInput, timeStr);

    // Find "Schedule send" button
    // It's usually the main action button in the dialog.
    // We can look for `button[name="..."]` or just the last button that looks like a confirm.
    // Often has class `T-I-KE` (blue button)

    setTimeout(() => {
        // Try to find the Confirm button ("Schedule send")
        // It's likely the last visible button in the dialog or has a specific submit style
        // We can search for the localized string if known, but we don't know it.
        // Search for primary action button?

        const allButtons = modal.querySelectorAll('div[role="button"], button');
        // Filter for visible ones
        let targetBtn = null;
        for (let i = allButtons.length - 1; i >= 0; i--) {
            const btn = allButtons[i];
            if (btn.offsetWidth > 0) {
                // Assume the last visible button is "Schedule send" (Cancel is usually before it or secondary)
                targetBtn = btn;
                break;
            }
        }

        // if (targetBtn) {
        //     console.log("Gmail Custom Schedule: Clicking schedule button", targetBtn);
        //     targetBtn.click();
        // }
    }, 500);
}

function simulateInput(element, value) {
    return new Promise(resolve => {
        element.focus();
        element.value = '';
        document.execCommand('insertText', false, value);
        element.dispatchEvent(new Event('input', { bubbles: true })); // 'input' is crucial for React/Angular
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
        setTimeout(resolve, 200);
    });
}
