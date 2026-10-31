const THEME_KEY = 'skillSwapTheme';

function getStoredTheme() {
    try {
        return localStorage.getItem(THEME_KEY);
    } catch (error) {
        return null;
    }
}

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setTheme(theme) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
        // localStorage may be unavailable in some environments
    }
    const toggle = document.getElementById('themeToggleBtn');
    if (toggle) {
        toggle.innerText = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
        toggle.setAttribute('aria-pressed', theme === 'dark');
    }
}


function toggleTheme() {
    document.body.classList.toggle("light-mode");

    const isLight = document.body.classList.contains("light-mode");
    const button = document.getElementById("themeToggleBtn");

    if (button) {
        button.textContent = isLight ? "Dark Mode" : "Light Mode";
    }

    localStorage.setItem("theme", isLight ? "light" : "dark");
}

document.addEventListener("DOMContentLoaded", function () {
    const savedTheme = localStorage.getItem("theme");
    const button = document.getElementById("themeToggleBtn");

    if (savedTheme === "light") {
        document.body.classList.add("light-mode");
    }

    if (button) {
        button.textContent =
            document.body.classList.contains("light-mode")
                ? "Dark Mode"
                : "Light Mode";
    }
});


function initTheme() {
    const storedTheme = getStoredTheme();
    const theme = storedTheme || getSystemTheme();
    setTheme(theme);
}

window.addEventListener('DOMContentLoaded', initTheme);
