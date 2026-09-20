const menuBtn = document.querySelector('[data-menu]');
const navLinks = document.querySelector('[data-navlinks]');
if (menuBtn && navLinks) menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
