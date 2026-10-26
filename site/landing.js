(function () {
  'use strict';
  // FoldLab waitlist form: https://formspree.io/forms/mdeeeywp
  var FORMSPREE_ID = 'mdeeeywp';

  var form = document.getElementById('waitlistForm');
  var note = document.getElementById('formNote');
  var email = document.getElementById('email');
  if (!form) return;

  function show(msg, isError) {
    note.hidden = false;
    note.textContent = msg;
    note.className = 'form-note' + (isError ? ' error' : '');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = (email.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      show('Enter a valid email.', true);
      email.focus();
      return;
    }

    if (!FORMSPREE_ID) {
      try {
        var key = 'foldlab-waitlist';
        var list = JSON.parse(localStorage.getItem(key) || '[]');
        if (list.indexOf(value) === -1) list.push(value);
        localStorage.setItem(key, JSON.stringify(list));
      } catch (err) {}
      show('You are on the list. Connect Formspree in landing.js to store emails on a server.');
      form.reset();
      return;
    }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    fetch('https://formspree.io/f/' + FORMSPREE_ID, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: value, source: 'foldlab-landing' })
    }).then(function (r) {
      if (!r.ok) throw new Error('bad status');
      show('Thanks — we will email you when there is news.');
      form.reset();
    }).catch(function () {
      show('Could not submit right now. Try again in a moment.', true);
    }).finally(function () {
      btn.disabled = false;
    });
  });
})();
