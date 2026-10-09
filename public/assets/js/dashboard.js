import { $, api, copyText, el, toast } from './ui.js';

const list = $('#rooms');
const empty = $('#empty');

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function row(room) {
  const copy = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Gastlink kopiëren',
    onclick: async () => toast((await copyText(room.guestUrl)) ? 'Gastlink gekopieerd' : 'Kopiëren lukte niet'),
  });

  const open = el('a', { class: 'btn btn-primary', href: room.ownerUrl, text: 'Binnenkomen' });

  const rename = el('button', {
    class: 'btn btn-quiet',
    type: 'button',
    text: 'Naam wijzigen',
    onclick: async () => {
      const name = prompt('Nieuwe naam voor deze ruimte', room.name);
      if (!name) return;
      await api('PATCH', `/api/rooms/${room.id}`, { name });
      await refresh();
      toast('Naam gewijzigd');
    },
  });

  const rotate = el('button', {
    class: 'btn btn-quiet',
    type: 'button',
    text: 'Nieuwe gastlink maken',
    onclick: async () => {
      if (!confirm('De huidige gastlink stopt dan met werken. Wie nu binnen is, wordt uit het gesprek gezet. Doorgaan?')) return;
      const { room: updated } = await api('POST', `/api/rooms/${room.id}/rotate`);
      await refresh();
      toast((await copyText(updated.guestUrl)) ? 'Nieuwe gastlink gekopieerd' : 'Nieuwe gastlink gemaakt');
    },
  });

  const remove = el('button', {
    class: 'btn btn-quiet btn-danger',
    type: 'button',
    text: 'Verwijderen',
    onclick: async () => {
      if (!confirm(`Ruimte "${room.name}" verwijderen? De gastlink werkt daarna niet meer.`)) return;
      await api('DELETE', `/api/rooms/${room.id}`);
      await refresh();
      toast('Ruimte verwijderd');
    },
  });

  return el(
    'li',
    { class: 'room-row' },
    el('div', {}, el('h2', { text: room.name }), el('p', { class: 'meta', text: `Gemaakt op ${formatDate(room.createdAt)}` })),
    el('div', { class: 'actions' }, copy, open),
    el('div', { class: 'more' }, rename, rotate, remove),
  );
}

async function refresh() {
  try {
    const { rooms } = await api('GET', '/api/rooms');
    list.replaceChildren(...rooms.map(row));
    empty.hidden = rooms.length > 0;
  } catch (err) {
    if (err.status === 401) location.href = '/login';
    else toast(err.message);
  }
}

$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#room-name');
  const { room } = await api('POST', '/api/rooms', { name: input.value });
  input.value = '';
  await refresh();
  toast((await copyText(room.guestUrl)) ? 'Ruimte gemaakt, gastlink gekopieerd' : 'Ruimte gemaakt');
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  location.href = '/login';
});

refresh();
