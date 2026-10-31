
document.addEventListener('DOMContentLoaded', () => {

    // Show or hide passwords.
    document.querySelectorAll('[data-toggle-password]').forEach(button => {
        button.addEventListener('click', () => {
            const inputId = button.dataset.togglePassword;
            const input = document.getElementById(inputId);

            if (!input) return;

            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';

            button.textContent = showing ? 'Show' : 'Hide';
            button.setAttribute(
                'aria-label',
                showing ? 'Show password' : 'Hide password'
            );
        });
    });

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    // Display success and error messages.
    function showMessage(message, type = 'error') {
        const element = document.getElementById('formMessage');

        if (!element) return;

        element.textContent = message;
        element.className = `form-message ${type}`;
    }

    // Disable the button while a request is processing.
    function setLoading(button, loading, label) {
        if (!button) return;

        button.disabled = loading;

        const span = button.querySelector('span');

        if (span) {
            span.textContent = loading ? 'Please wait...' : label;
        }
    }

    // Send data to the backend and handle server errors.
    async function sendRequest(url, body) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error(
                'The server returned an invalid response. Please try again.'
            );
        }

        if (!response.ok) {
            throw new Error(data.msg || 'Something went wrong.');
        }

        return data;
    }

    // =========================
    // LOGIN
    // =========================
    if (loginForm) {
        loginForm.addEventListener('submit', async event => {
            event.preventDefault();

            const button = document.getElementById('submitButton');
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');

            const email = emailInput.value.trim().toLowerCase();
            const password = passwordInput.value;

            if (!loginForm.reportValidity()) return;

            setLoading(button, true, 'Log in to your account');

            try {
                const data = await sendRequest('/api/auth/login', {
                    email,
                    password
                });

                // Save login details in the browser.
                localStorage.setItem(
                    'currentUser',
                    JSON.stringify(data.user)
                );

                localStorage.setItem('authToken', data.token);

                showMessage(
                    'Login successful! Opening your dashboard...',
                    'success'
                );

                window.location.href = "/dashboard";

            } catch (error) {
                showMessage(error.message);
                setLoading(button, false, 'Log in to your account');
            }
        });
    }

    // =========================
    // REGISTER
    // =========================
    if (registerForm) {
        registerForm.addEventListener('submit', async event => {
            event.preventDefault();

            const button = document.getElementById('submitButton');
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const confirmPasswordInput =
                document.getElementById('confirmPassword');

            const email = emailInput.value.trim().toLowerCase();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            // Check required fields and input types.
            if (!registerForm.reportValidity()) return;

            // Validate password length.
            if (password.length < 8) {
                showMessage(
                    'Your password must contain at least 8 characters.'
                );
                passwordInput.focus();
                return;
            }

            // Check password confirmation.
            if (password !== confirmPassword) {
                showMessage('The passwords do not match.');
                confirmPasswordInput.focus();
                return;
            }

            setLoading(button, true, 'Create my account');

            try {
                // Send registration details to the Express backend.
                // The backend inserts the new user into MySQL.
                const data = await sendRequest('/api/auth/register', {
                    email,
                    password
                });

                showMessage(
                    data.msg ||
                    'Account created successfully! Redirecting to login...',
                    'success'
                );

                // Redirect only after successful MySQL registration.
                window.setTimeout(() => {
                    window.location.assign('/login');
                }, 1200);

            } catch (error) {
                // For example: email already registered or server error.
                showMessage(error.message);
                setLoading(button, false, 'Create my account');
            }
        });
    }
});
