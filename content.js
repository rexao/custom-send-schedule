// Custom Send Schedule Content Script

let presets = [];

// --- Utilities ---

function getNextDay(dayOfWeek) {
    const d = new Date();
    d.setDate(d.getDate() + ((dayOfWeek + 7 - d.getDay()) % 7));
    if (d <= new Date()) {
        d.setDate(d.getDate() + 7);
    }
    return d;
}

function calculateTargetDate(preset) {
    const now = new Date();
    let target = new Date(); // Start with *now*

    // Handle Date
    if (preset.dayType === 'today') {
        // Leave as today
    } else if (preset.dayType === 'tomorrow') {
        target.setDate(now.getDate() + 1);
    } else if (preset.dayType === 'nextWeek') {
        // Next Monday (1)
        target.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
    } else if (preset.dayType === 'customDays') {
        target.setDate(now.getDate() + (preset.daysOffset || 1));
    } else if (preset.dayType === 'nextDay') {
        let daysToAdd = (preset.targetDay + 7 - now.getDay()) % 7;
        if (daysToAdd === 0) daysToAdd = 7;
        target.setDate(now.getDate() + daysToAdd);
    }

    // Handle Time
    if (preset.time) {
        const [hours, minutes] = preset.time.split(':').map(Number);
        target.setHours(hours, minutes, 0, 0);
    }

    return target;
}

function formatTime(preset, localeOptions) {
    const d = calculateTargetDate(preset);
    const locale = document.documentElement.lang || window.navigator.language;
    return d.toLocaleString(locale, localeOptions || { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function formatDateOnly(preset) {
    const d = calculateTargetDate(preset);
    const locale = document.documentElement.lang || window.navigator.language;

    if (locale.startsWith('ja')) {
        // Outlook Japanese format: "2026 年 2 月 16 日 (月)" (with spaces)
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const dt = d.getDate();
        const dayMap = ['日', '月', '火', '水', '木', '金', '土'];
        const wd = dayMap[d.getDay()];
        return `${y} 年 ${m} 月 ${dt} 日 (${wd})`;
    }

    return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function formatTimeOnly(preset) {
    const d = calculateTargetDate(preset);
    const locale = document.documentElement.lang || window.navigator.language;
    return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

async function simulateInput(element, value) {
    return new Promise(resolve => {
        element.focus();
        element.value = '';
        document.execCommand('insertText', false, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
        setTimeout(resolve, 200);
    });
}

function waitForElement(selector, parent = document, timeout = 3000) {
    return new Promise(resolve => {
        if (parent.querySelector(selector)) return resolve(parent.querySelector(selector));

        const observer = new MutationObserver(() => {
            if (parent.querySelector(selector)) {
                observer.disconnect();
                resolve(parent.querySelector(selector));
            }
        });

        observer.observe(parent, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}


// --- Providers ---

class GmailProvider {
    constructor() {
        this.name = 'Gmail';
    }

    detectChanges() {
        setInterval(() => this.checkForMenu(), 1000);
    }

    checkForMenu() {
        // Look for menu items with specific structure
        const menuItems = document.querySelectorAll('div[role="menuitem"]');
        for (const item of menuItems) {
            // Gmail specific: <div class="Aj">Label</div><div class="Ay">Time</div>
            const hasStructure = item.querySelector('.Aj') && item.querySelector('.Ay');
            if (hasStructure) {
                const menuContainer = item.parentElement;
                if (menuContainer && !menuContainer.getAttribute('data-custom-scheduled-injected')) {
                    const siblings = menuContainer.querySelectorAll('div[role="menuitem"]');
                    if (siblings.length >= 2) {
                        console.log("Custom Schedule: Found Gmail Menu", menuContainer);
                        menuContainer.setAttribute('data-custom-scheduled-injected', 'true');
                        // Inject before the *last* item ("Pick date & time")
                        const lastItem = siblings[siblings.length - 1];
                        this.injectItems(menuContainer, lastItem, item);
                        return;
                    }
                }
            }
        }
    }

    injectItems(container, refElement, templateElement) {
        // Separator
        const separator = document.createElement('div');
        separator.style.borderTop = '1px solid #e0e0e0';
        separator.style.margin = '4px 0';
        container.insertBefore(separator, refElement);

        presets.forEach(preset => {
            const item = templateElement.cloneNode(true);
            const labelNode = item.querySelector('.Aj');
            const timeNode = item.querySelector('.Ay');

            if (labelNode) labelNode.textContent = preset.label;
            if (timeNode) timeNode.textContent = formatTime(preset);

            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Find "Pick date & time" (refElement might be stale if menu re-renders, so find freshly)
                const freshSiblings = container.querySelectorAll('div[role="menuitem"]');
                const pickDateItem = freshSiblings[freshSiblings.length - 1];
                this.handlePresetClick(preset, pickDateItem);
            });

            // Hover effect handled by Gmail usually, but we can add simple feedback
            item.addEventListener('mouseenter', () => item.style.backgroundColor = '#f1f3f4'); // Gmail hover color
            item.addEventListener('mouseleave', () => item.style.backgroundColor = '');

            container.insertBefore(item, refElement);
        });
    }

    async handlePresetClick(preset, pickDateItem) {
        const targetDate = calculateTargetDate(preset);
        pickDateItem.click();

        // Wait for modal
        // Gmail modal title "Pick date & time"
        const modal = await this.waitForModal();
        if (modal) {
            await this.fillModal(modal, targetDate);
        }
    }

    async waitForModal() {
        return new Promise(resolve => {
            let attempts = 0;
            const int = setInterval(() => {
                attempts++;
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                for (const dialog of dialogs) {
                    if (dialog.offsetWidth > 0 && dialog.querySelectorAll('input[type="text"]').length >= 2) {
                        clearInterval(int);
                        resolve(dialog);
                        return;
                    }
                }
                if (attempts > 30) { clearInterval(int); resolve(null); }
            }, 100);
        });
    }

    async fillModal(modal, date) {
        const inputs = modal.querySelectorAll('input[type="text"]');
        if (inputs.length < 2) return;

        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

        await simulateInput(inputs[0], dateStr);
        await simulateInput(inputs[1], timeStr);

        // Click "Schedule send"
        // Usually last button
        setTimeout(() => {
            const buttons = modal.querySelectorAll('div[role="button"], button');
            for (let i = buttons.length - 1; i >= 0; i--) {
                if (buttons[i].offsetWidth > 0) {
                    buttons[i].click();
                    break;
                }
            }
        }, 500);
    }
}

class OutlookProvider {
    constructor() {
        this.name = 'Outlook';
    }

    detectChanges() {
        setInterval(() => this.checkForMenu(), 500); // Check more frequently
    }

    checkForMenu() {
        const containers = document.querySelectorAll('.fui-DialogContent');
        for (const container of containers) {
            // 1. Check if we are in the Date Picker view
            const datePicker = container.querySelector('.MsdyM');

            if (datePicker) {
                // We are in Picker view. Ensure CLEANUP.
                this.cleanupCustomItems(container);
                container.removeAttribute('data-custom-scheduled-injected');
                continue;
            }

            // 2. We are likely in the Menu view.

            // Check if Outlook has re-populated its own items. 
            // We expect standard preset buttons.
            const buttons = Array.from(container.querySelectorAll('button'));
            const customItems = container.querySelectorAll('.custom-schedule-item');

            // Filter out our own items to see what Outlook has
            const nativeButtons = buttons.filter(b => !b.classList.contains('custom-schedule-item'));

            if (nativeButtons.length === 0) {
                // Menu might be empty or loading
                continue;
            }

            // Early exit if no presets
            if (presets.length === 0) {
                if (container.getAttribute('data-custom-scheduled-injected')) {
                    this.cleanupCustomItems(container);
                    container.removeAttribute('data-custom-scheduled-injected');
                }
                continue;
            }

            // Check if injection is needed
            // If we marked it as injected, but the order is wrong (Outlook re-appended items after ours),
            // or if our items are missing.

            const lastNativeButton = nativeButtons[nativeButtons.length - 1]; // "Custom time" usually

            // Validate structure of a native button to ensure it's the schedule menu
            // (One button with date/time p tags)
            let validMenu = false;
            let templateButton = null;
            for (const btn of nativeButtons) {
                if (btn.querySelectorAll('p').length >= 2) {
                    validMenu = true;
                    templateButton = btn;
                    break;
                }
            }

            if (!validMenu) continue;

            // Decision: Should we inject?
            // If not marked injected -> Inject
            // If marked injected but custom items are missing -> Inject
            // If marked injected but custom items are BEFORE some native items (order messed up) -> Re-inject

            let needInjection = false;
            if (!container.getAttribute('data-custom-scheduled-injected')) {
                needInjection = true;
            } else {
                if (customItems.length === 0) {
                    needInjection = true;
                } else {
                    // Check order: Custom items should be immediately before the LAST native button ("Custom time")
                    // If the last element in container is a native button (other than the custom time pivot?), 
                    // it means Outlook appended things after us.

                    // Actually, simpler check: 
                    // The element *after* our last custom item should be the `lastNativeButton`.
                    // If `lastNativeButton` is NOT the immediate next sibling of our last separator/item, fix it.

                    const lastCustomItem = customItems[customItems.length - 1];
                    if (lastCustomItem.nextElementSibling !== lastNativeButton) {
                        console.log("Custom Schedule: Order mismatch, re-injecting...");
                        this.cleanupCustomItems(container); // Remove to re-add correctly
                        needInjection = true;
                    }
                }
            }

            if (needInjection && templateButton && lastNativeButton) {
                console.log("Custom Schedule: Injecting Outlook items");
                this.injectItems(container, lastNativeButton, templateButton);
                container.setAttribute('data-custom-scheduled-injected', 'true');
            }
        }
    }

    cleanupCustomItems(container) {
        const items = container.querySelectorAll('.custom-schedule-item, .custom-schedule-separator');
        items.forEach(el => el.remove());
    }

    injectItems(container, refElement, templateElement) {
        if (presets.length === 0) return;

        // Separator
        const separator = document.createElement('div');
        separator.style.borderTop = '1px solid #edebe9';
        separator.classList.add('custom-schedule-separator');
        separator.style.margin = '4px 8px';
        container.insertBefore(separator, refElement);

        presets.forEach(preset => {
            const item = templateElement.cloneNode(true);
            item.classList.add('custom-schedule-item');

            // Modify content
            const paragraphs = item.querySelectorAll('p');
            if (paragraphs.length >= 2) {
                paragraphs[0].textContent = formatDateOnly(preset);
                paragraphs[1].textContent = formatTimeOnly(preset);
            }

            item.removeAttribute('value');
            item.removeAttribute('id');

            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Click the "Custom time" button to switch view
                // We find it again to be safe
                const currentButtons = container.querySelectorAll('button:not(.custom-schedule-item)');
                const customTimeBtn = currentButtons[currentButtons.length - 1];
                this.handlePresetClick(preset, customTimeBtn);
            });

            container.insertBefore(item, refElement);
        });
    }

    async handlePresetClick(preset, customTimeBtn) {
        const targetDate = calculateTargetDate(preset);

        // Trigger view switch
        if (customTimeBtn) customTimeBtn.click();

        // Wait for modal (Picker View)
        const datePicker = await this.waitForDatePicker();
        if (datePicker) {
            await this.fillDatePicker(datePicker, targetDate);
        }
    }

    async waitForDatePicker() {
        return new Promise(resolve => {
            let attempts = 0;
            const int = setInterval(() => {
                attempts++;
                // Look for the specific class user mentioned
                const picker = document.querySelector('.MsdyM');
                if (picker) {
                    clearInterval(int);
                    resolve(picker);
                    return;
                }
                if (attempts > 30) { clearInterval(int); resolve(null); }
            }, 100);
        });
    }

    async fillDatePicker(pickerContainer, date) {
        console.log("Outlook: Filling picker", date);
        const inputs = pickerContainer.querySelectorAll('input');

        if (inputs.length >= 2) {
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

            await simulateInput(inputs[0], dateStr);
            await simulateInput(inputs[1], timeStr);
        }

        // Find "Send" / "Schedule" button
        // In this view, there should be a primary button to confirm
        setTimeout(() => {
            // Search in the dialog content wrapper, which might be parent of picker
            const dialogContent = pickerContainer.closest('.fui-DialogContent');
            if (dialogContent) {
                const buttons = dialogContent.querySelectorAll('button');
                let targetBtn = null;
                for (const btn of buttons) {
                    // Outlook primary button class often contains 'Primary'
                    if (btn.className.includes('Primary')) {
                        targetBtn = btn;
                        break;
                    }
                }
                // Check if last button is it
                if (!targetBtn && buttons.length > 0) targetBtn = buttons[buttons.length - 1];

                if (targetBtn) {
                    // console.log("Clicking Schedule", targetBtn);
                    // targetBtn.click();
                }
            }
        }, 500);
    }
}


// --- Main ---

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
        initProvider();
    });
}

function initProvider() {
    const host = window.location.hostname;
    let provider = null;

    if (host.includes('mail.google.com')) {
        provider = new GmailProvider();
    } else if (host.includes('outlook.live.com') || host.includes('outlook.office.com')) {
        provider = new OutlookProvider();
    }

    if (provider) {
        console.log(`Custom Schedule: Initializing ${provider.name} provider`);
        provider.detectChanges();
    } else {
        console.log("Custom Schedule: Unknown provider for host", host);
    }
}

// Watch for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.presets) {
        presets = changes.presets.newValue;
    }
});

// Start
loadPresets();
