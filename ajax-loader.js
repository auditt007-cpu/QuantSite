document.addEventListener('DOMContentLoaded', function() {
  fetch('/api/poem')
    .then(response => response.json())
    .then(data => {
      const nameEl = document.getElementById('poet-name');
      const poemEl = document.getElementById('poem-content');
      if (nameEl) nameEl.textContent = data.poet;
      if (poemEl) poemEl.textContent = data.poem;
    })
    .catch(err => console.error('AJAX load error:', err));
});
