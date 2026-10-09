import { $, api } from './ui.js';

const form = $('#login-form');
const error = $('#error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('POST', '/api/login', { password: $('#password').value });
    location.href = '/';
  } catch (err) {
    error.textContent = err.message;
    $('#password').select();
  } finally {
    button.disabled = false;
  }
});
