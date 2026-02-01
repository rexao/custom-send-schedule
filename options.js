// Logic for saving and restoring options

const defaultPresets = [
  { label: "Tomorrow Morning", dayType: "tomorrow", time: "08:00" },
  { label: "Tomorrow Afternoon", dayType: "tomorrow", time: "13:00" },
  { label: "Monday Morning", dayType: "nextWeek", time: "08:00" }
];

function saveOptions() {
  // Logic is handled by addPreset directly modifying storage, but 
  // we might want a simple save function if we edited existing ones.
  // For now, we just add/remove.
}

function loadOptions() {
  chrome.storage.sync.get({
    presets: defaultPresets
  }, function (items) {
    renderPresets(items.presets);
  });
}

function renderPresets(presets) {
  const list = document.getElementById('presetList');
  list.innerHTML = '';

  presets.forEach((preset, index) => {
    const div = document.createElement('div');
    div.className = 'preset-item';
    div.setAttribute('draggable', 'true'); // Enable dragging
    div.dataset.index = index; // Store index

    let details = `${preset.time}`;
    if (preset.dayType === 'tomorrow') details += ', Tomorrow';
    else if (preset.dayType === 'nextWeek') details += ', Next Monday';
    else if (preset.dayType === 'customDays') details += `, In ${preset.daysOffset} days`;
    else if (preset.dayType === 'nextDay') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      details += `, Next ${days[parseInt(preset.targetDay)]}`;
    }

    div.innerHTML = `
      <div class="preset-info">
        <div class="preset-label">${preset.label}</div>
        <div class="preset-details">${details}</div>
      </div>
      <div>
        <button class="edit-btn" data-index="${index}">&#9998;</button>
        <button class="delete-btn" data-index="${index}">&times;</button>
      </div>
    `;

    // Drag Events
    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragover', handleDragOver);
    div.addEventListener('drop', handleDrop);
    div.addEventListener('dragenter', handleDragEnter);
    div.addEventListener('dragleave', handleDragLeave);
    div.addEventListener('dragend', handleDragEnd);

    list.appendChild(div);
  });

  // Add delete listeners
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
      // e.stopPropagation(); // prevent drag interference?
      const index = parseInt(this.dataset.index);
      presets.splice(index, 1);
      saveAndRender(presets);
      document.getElementById('refreshContainer').style.display = 'block';
      showStatus('Deleted!', 'green');
    });
  });

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
      const index = parseInt(this.dataset.index);
      editPreset(index, presets);
    });
  });
}

function editPreset(index, presets) {
  const preset = presets[index];
  editingIndex = index;

  document.getElementById('label').value = preset.label;
  document.getElementById('dayType').value = preset.dayType;
  document.getElementById('time').value = preset.time;

  if (preset.daysOffset) document.getElementById('daysOffset').value = preset.daysOffset;
  if (preset.targetDay !== undefined) document.getElementById('targetDay').value = preset.targetDay;

  // Trigger change to update visibility of conditional fields
  document.getElementById('dayType').dispatchEvent(new Event('change'));

  document.getElementById('addPreset').textContent = 'Update Preset';
  document.getElementById('label').focus();

  // Scroll to form
  document.querySelector('.add-form').scrollIntoView({ behavior: 'smooth' });
}

// Drag & Drop Handlers
let dragSrcEl = null;

function handleDragStart(e) {
  dragSrcEl = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
  this.classList.add('dragging');
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault(); // Necessary. Allows us to drop.
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  this.classList.add('over');
}

function handleDragLeave(e) {
  this.classList.remove('over');
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation(); // stops the browser from redirecting.
  }

  if (dragSrcEl !== this) {
    // Reorder array
    const oldIndex = parseInt(dragSrcEl.dataset.index);
    const newIndex = parseInt(this.dataset.index);

    // Get latest presets from storage to be safe or use closures? 
    // We can just rely on the fact that renderPresets binds to the current array state?
    // Better to reload from storage or strictly pass data. 
    // Let's reload to be robust or simple swap locally then save.

    chrome.storage.sync.get({ presets: defaultPresets }, function (items) {
      const currentPresets = items.presets;
      // Move item
      const itemMoved = currentPresets.splice(oldIndex, 1)[0];
      currentPresets.splice(newIndex, 0, itemMoved);

      saveAndRender(currentPresets);
    });
  }
  return false;
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  // cleanup
  document.querySelectorAll('.preset-item').forEach(item => {
    item.classList.remove('over');
  });
}

function saveAndRender(newPresets) {
  chrome.storage.sync.set({ presets: newPresets }, () => {
    renderPresets(newPresets);
  });
}

let editingIndex = -1;


function addPreset() {
  const label = document.getElementById('label').value;
  const dayType = document.getElementById('dayType').value;
  const time = document.getElementById('time').value;
  const daysOffset = document.getElementById('daysOffset').value;
  const targetDay = document.getElementById('targetDay').value;

  if (!label) {
    showStatus('Please enter a label', 'red');
    return;
  }

  const newPreset = {
    label,
    dayType,
    time,
    daysOffset: dayType === 'customDays' ? parseInt(daysOffset) : undefined,
    targetDay: dayType === 'nextDay' ? parseInt(targetDay) : undefined
  };

  chrome.storage.sync.get({ presets: defaultPresets }, function (items) {
    const presets = items.presets;

    if (editingIndex >= 0) {
      // Update existing
      presets[editingIndex] = newPreset;
      editingIndex = -1;
      document.getElementById('addPreset').textContent = 'Add Preset';
      showStatus('Updated!', 'green');
    } else {
      // Add new
      presets.push(newPreset);
      showStatus('Saved!', 'green');
    }

    chrome.storage.sync.set({ presets: presets }, function () {
      // Reset form
      document.getElementById('label').value = '';
      document.getElementById('dayType').value = 'tomorrow';
      document.getElementById('dayType').dispatchEvent(new Event('change'));
      document.getElementById('time').value = '09:00';
      document.getElementById('daysOffset').value = '1';
      document.getElementById('targetDay').value = '1';

      renderPresets(presets);
      document.getElementById('refreshContainer').style.display = 'block';
    });
  });
}

function showStatus(msg, color) {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.style.color = color || 'black';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

document.addEventListener('DOMContentLoaded', loadOptions);
document.getElementById('addPreset').addEventListener('click', addPreset);
document.getElementById('refreshGmail').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      chrome.tabs.reload(tabs[0].id);
      document.getElementById('refreshContainer').style.display = 'none';
      showStatus('Refreshed!', 'green');
    }
  });
});

// Handle logic for showing/hiding inputs
document.getElementById('dayType').addEventListener('change', function () {
  const val = this.value;
  document.getElementById('customDaysGroup').style.display = val === 'customDays' ? 'block' : 'none';
  document.getElementById('nextDayGroup').style.display = val === 'nextDay' ? 'block' : 'none';
});
