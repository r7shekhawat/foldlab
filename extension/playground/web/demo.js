(function () {
  'use strict';
  var app = document.getElementById('app');
  var status = document.getElementById('status');

  document.getElementById('naive').addEventListener('change', function (e) {
    app.classList.toggle('naive', e.target.checked);
  });

  function show(s) {
    var n = s.segments.length;
    status.textContent = n > 1
      ? n + ' segments, ' + s.orientation + ' hinge, posture ' + s.posture
      : '1 segment, posture ' + s.posture;
  }

  show(window.foldlab.state);
  window.foldlab.onChange(show);
})();
