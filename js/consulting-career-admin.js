(function () {
  'use strict';

  const keyInput = document.getElementById('career-admin-key');
  const filter = document.getElementById('career-admin-filter');
  const loadButton = document.getElementById('career-admin-load');
  const exportButton = document.getElementById('career-admin-export');
  const status = document.getElementById('career-admin-status');
  const list = document.getElementById('career-admin-list');
  const statusOptions = [
    ['new', '新規'], ['contacted', '連絡済み'], ['qualified_candidate', '有効候補者'],
    ['agent_referral', '紹介済み'], ['interview', '選考中'], ['joined', '入社'], ['closed', '終了']
  ];

  const savedKey = sessionStorage.getItem('careerAdminKey') || '';
  keyInput.value = savedKey;

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.className = `career-admin-status${isError ? ' is-error' : ''}`;
  };

  const request = async (url, options = {}) => {
    const headers = { ...(options.headers || {}), 'X-Admin-Key': keyInput.value.trim() };
    const response = await fetch(url, { ...options, headers });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(data?.detail || '管理APIの処理に失敗しました。');
    return { response, data };
  };

  const makeCell = (text) => {
    const cell = document.createElement('td');
    cell.textContent = text || '-';
    return cell;
  };

  const render = (applications) => {
    list.replaceChildren();
    if (!applications.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'career-admin-empty';
      cell.textContent = '申込はありません。';
      row.appendChild(cell);
      list.appendChild(row);
      return;
    }

    applications.forEach((application) => {
      const row = document.createElement('tr');
      const created = makeCell(application.created_at);
      const applicant = document.createElement('td');
      applicant.textContent = application.name;
      const contact = document.createElement('small');
      contact.textContent = `${application.email} / ${application.phone}`;
      applicant.appendChild(contact);
      const appointment = makeCell(application.appointment || '後日調整');
      const source = document.createElement('td');
      source.textContent = application.source || 'unknown';
      const attribution = document.createElement('small');
      attribution.textContent = application.utm_campaign || application.gclid ? `campaign: ${application.utm_campaign || '-'} / gclid: ${application.gclid ? 'あり' : 'なし'}` : '広告情報なし';
      source.appendChild(attribution);
      const statusCell = document.createElement('td');
      const select = document.createElement('select');
      statusOptions.forEach(([value, label]) => {
        const option = new Option(label, value, false, application.application_status === value);
        select.appendChild(option);
      });
      statusCell.appendChild(select);
      const notesCell = document.createElement('td');
      const notes = document.createElement('textarea');
      notes.value = application.admin_notes || '';
      notesCell.appendChild(notes);
      const actionCell = document.createElement('td');
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'career-admin-save';
      save.textContent = '保存';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await request(`/api/admin/consulting-career/applications/${encodeURIComponent(application.application_id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: select.value, admin_notes: notes.value })
          });
          setStatus('更新しました。');
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          save.disabled = false;
        }
      });
      actionCell.appendChild(save);
      row.append(created, applicant, appointment, source, statusCell, notesCell, actionCell);
      list.appendChild(row);
    });
  };

  const load = async () => {
    if (!keyInput.value.trim()) {
      setStatus('管理キーを入力してください。', true);
      return;
    }
    sessionStorage.setItem('careerAdminKey', keyInput.value.trim());
    setStatus('読み込み中…');
    try {
      const query = filter.value ? `?status=${encodeURIComponent(filter.value)}` : '';
      const { data } = await request(`/api/admin/consulting-career/applications${query}`);
      render(data);
      setStatus(`${data.length}件を読み込みました。`);
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  const exportCsv = async () => {
    if (!keyInput.value.trim()) {
      setStatus('管理キーを入力してください。', true);
      return;
    }
    try {
      const { response } = await request('/api/admin/consulting-career/applications/export');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'consulting-career-applications.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus('CSVを出力しました。');
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  loadButton.addEventListener('click', load);
  filter.addEventListener('change', load);
  exportButton.addEventListener('click', exportCsv);
})();
