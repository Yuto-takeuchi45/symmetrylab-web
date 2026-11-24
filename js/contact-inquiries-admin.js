/**
 * 管理画面「お問い合わせ」タブの処理。
 * HPのお問い合わせ（お問い合わせページ・サービスページのコンサル相談）を一覧表示し、
 * 対応状況と管理メモの更新、CSV出力を行う。認証は管理画面のログインで保存された管理キーを使う。
 */
(function () {
  'use strict';

  const list = document.getElementById('contact-inquiries-list');
  if (!list) return;

  const statusMessage = document.getElementById('inquiry-status-message');
  const formFilter = document.getElementById('inquiry-form-filter');
  const statusFilter = document.getElementById('inquiry-status-filter');
  const searchInput = document.getElementById('inquiry-search');
  // 選択肢はサーバーの CONTACT_INQUIRY_STATUSES と一致させる
  const STATUS_CHOICES = [['new', '新規'], ['in_progress', '対応中'], ['completed', '対応済み'], ['excluded', '対象外']];
  const FORM_LABELS = { general: 'お問い合わせページ', consulting: 'コンサルのご相談' };
  let inquiries = [];

  /**
   * 応答をJSONとして読む。JSON以外（中継サーバーのエラー画面など）の場合は null を返す。
   * @param {Response} response fetch の応答
   * @returns {Promise<any>} 解析結果
   */
  async function readJson(response) {
    if (!(response.headers.get('content-type') || '').includes('application/json')) return null;
    try { return await response.json(); } catch (_error) { return null; }
  }

  /**
   * サーバーのエラー説明を取り出す。文字列でない場合（入力検証の詳細など）は既定の文言を使う。
   * @param {any} data 応答のJSON
   * @param {string} fallback 既定の文言
   * @returns {string} 表示する文言
   */
  function errorText(data, fallback) {
    return data && typeof data.detail === 'string' ? data.detail : fallback;
  }

  /**
   * 一覧上部の状況メッセージを表示する。
   * @param {string} message 表示する文言
   * @param {boolean} isError エラーとして表示するか
   */
  function setMessage(message, isError) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle('is-error', Boolean(isError));
  }

  /**
   * ログイン時に保存された管理キーを返す。未ログインならメッセージを出して空文字を返す。
   * @returns {string} 管理キー
   */
  function adminKey() {
    const key = sessionStorage.getItem('adminKey') || '';
    if (!key) setMessage('先に管理画面へログインしてください。', true);
    return key;
  }

  /**
   * 保存日時（UTC・ISO形式）を日本時間の表示にする。
   * @param {string} value 保存日時
   * @returns {string} 表示用の日時
   */
  function displayDate(value) {
    if (!value) return '—';
    const text = String(value);
    const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
    if (Number.isNaN(date.getTime())) return text.replace('T', ' ').slice(0, 16);
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  /**
   * セルの下に補足の小さな文字を追加する（入力値は textContent で入れ、HTMLとして解釈させない）。
   * @param {HTMLElement} parent 追加先
   * @param {string} text 文言（空なら追加しない）
   */
  function smallText(parent, text) {
    if (!text) return;
    const small = document.createElement('small');
    small.textContent = text;
    parent.appendChild(small);
  }

  /**
   * 絞り込み条件と検索語に合うお問い合わせを返す。
   * @returns {Array<object>} 表示対象
   */
  function visibleInquiries() {
    const query = searchInput.value.trim().toLowerCase();
    return inquiries.filter((item) => {
      if (formFilter.value && item.form_type !== formFilter.value) return false;
      if (statusFilter.value && item.inquiry_status !== statusFilter.value) return false;
      if (!query) return true;
      return [item.name, item.company, item.email, item.phone, item.inquiry_type, item.message, item.admin_notes, item.inquiry_id]
        .join(' ').toLowerCase().includes(query);
    });
  }

  /**
   * 1件分の行を作る。
   * @param {object} item お問い合わせ
   * @returns {HTMLTableRowElement} 行
   */
  function buildRow(item) {
    const row = document.createElement('tr');

    const dateCell = document.createElement('td');
    dateCell.textContent = displayDate(item.created_at);
    row.appendChild(dateCell);

    const typeCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `lead-source${item.form_type === 'consulting' ? ' google' : ''}`;
    badge.textContent = FORM_LABELS[item.form_type] || item.form_type;
    typeCell.appendChild(badge);
    smallText(typeCell, item.inquiry_type);
    row.appendChild(typeCell);

    const personCell = document.createElement('td');
    personCell.textContent = item.name || '—';
    smallText(personCell, item.company);
    smallText(personCell, item.occupation);
    smallText(personCell, item.email);
    smallText(personCell, item.phone);
    row.appendChild(personCell);

    const messageCell = document.createElement('td');
    const message = document.createElement('div');
    message.style.whiteSpace = 'pre-wrap';
    message.style.maxWidth = '420px';
    message.textContent = item.message || '—';
    messageCell.appendChild(message);
    smallText(messageCell, item.page_url ? `送信ページ：${item.page_url}` : '');
    smallText(messageCell, `受付ID：${item.inquiry_id}`);
    row.appendChild(messageCell);

    const statusCell = document.createElement('td');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `${item.name || 'お問い合わせ'}の対応状況`);
    STATUS_CHOICES.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = item.inquiry_status === value;
      select.appendChild(option);
    });
    statusCell.appendChild(select);
    smallText(statusCell, item.updated_at && item.updated_at !== item.created_at ? `更新：${displayDate(item.updated_at)}` : '');
    row.appendChild(statusCell);

    const notesCell = document.createElement('td');
    const notes = document.createElement('textarea');
    notes.value = item.admin_notes || '';
    notes.maxLength = 5000;
    notes.setAttribute('aria-label', `${item.name || 'お問い合わせ'}の管理メモ`);
    notesCell.appendChild(notes);
    row.appendChild(notesCell);

    const actionCell = document.createElement('td');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'lead-save';
    save.textContent = '保存';
    save.addEventListener('click', () => saveInquiry(item, select, notes, save));
    actionCell.appendChild(save);
    row.appendChild(actionCell);
    return row;
  }

  /** 上部の件数表示を更新する。 */
  function renderCounts() {
    document.getElementById('inquiry-count-total').textContent = inquiries.length.toLocaleString('ja-JP');
    document.getElementById('inquiry-count-new').textContent = inquiries.filter((i) => i.inquiry_status === 'new').length.toLocaleString('ja-JP');
    document.getElementById('inquiry-count-consulting').textContent = inquiries.filter((i) => i.form_type === 'consulting').length.toLocaleString('ja-JP');
  }

  /** 件数と一覧を描き直す。 */
  function render() {
    renderCounts();
    list.replaceChildren();
    const visible = visibleInquiries();
    if (!visible.length) {
      const row = document.createElement('tr');
      const empty = document.createElement('td');
      empty.className = 'lead-empty';
      empty.colSpan = 7;
      empty.textContent = inquiries.length ? '条件に一致するお問い合わせはありません。' : 'お問い合わせはまだありません。';
      row.appendChild(empty);
      list.appendChild(row);
      return;
    }
    visible.forEach((item) => list.appendChild(buildRow(item)));
  }

  /**
   * 対応状況と管理メモを保存する。
   * @param {object} item 対象のお問い合わせ
   * @param {HTMLSelectElement} select 対応状況の選択欄
   * @param {HTMLTextAreaElement} notes 管理メモ欄
   * @param {HTMLButtonElement} button 保存ボタン
   */
  async function saveInquiry(item, select, notes, button) {
    const key = adminKey();
    if (!key) return;
    button.disabled = true;
    button.textContent = '保存中';
    try {
      const response = await fetch(`/api/admin/contact/inquiries/${encodeURIComponent(item.inquiry_id)}`, {
        method: 'PATCH',
        headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ status: select.value, admin_notes: notes.value })
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorText(data, `保存できませんでした（${response.status}）。`));
      item.inquiry_status = select.value;
      item.admin_notes = notes.value.trim();
      item.updated_at = new Date().toISOString();
      notes.value = item.admin_notes;
      setMessage(`${item.name || 'お問い合わせ'}の対応状況を保存しました。`, false);
      // 一覧全体を描き直すと、他の行で入力中の未保存メモが消えるため、件数表示だけ更新する
      renderCounts();
    } catch (error) {
      setMessage(error.message || '保存できませんでした。', true);
    } finally {
      button.disabled = false;
      button.textContent = '保存';
    }
  }

  /**
   * お問い合わせを全件読み込む。APIは1回500件までなので、足りない分は続けて取得する。
   */
  async function loadContactInquiries() {
    const key = adminKey();
    if (!key) return;
    setMessage('お問い合わせを読み込んでいます…', false);
    try {
      const pageSize = 500;
      const loaded = [];
      for (let offset = 0; ; offset += pageSize) {
        const response = await fetch(`/api/admin/contact/inquiries?limit=${pageSize}&offset=${offset}`, {
          headers: { 'X-Admin-Key': key, 'Accept': 'application/json' }
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(errorText(data, `お問い合わせを読み込めませんでした（${response.status}）。`));
        if (!Array.isArray(data)) throw new Error('お問い合わせデータの形式が正しくありません。');
        loaded.push(...data);
        if (data.length < pageSize) break;
      }
      inquiries = loaded;
      render();
      setMessage(`${inquiries.length.toLocaleString('ja-JP')}件を読み込みました（全件）。`, false);
    } catch (error) {
      inquiries = [];
      render();
      setMessage(error.message || 'お問い合わせを読み込めませんでした。', true);
    }
  }

  /**
   * お問い合わせ全件をCSVで保存する。管理キーをURLに載せないよう、ヘッダー付きで取得してから保存する。
   */
  async function exportContactInquiries() {
    const key = adminKey();
    if (!key) return;
    try {
      const response = await fetch('/api/admin/contact/inquiries/export', { headers: { 'X-Admin-Key': key } });
      if (!response.ok) throw new Error(errorText(await readJson(response), `CSVを出力できませんでした（${response.status}）。`));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'contact-inquiries.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // 保存処理が始まる前に解放するとダウンロードが失敗するブラウザがあるため、少し待ってから解放する
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setMessage(error.message || 'CSVを出力できませんでした。', true);
    }
  }

  window.loadContactInquiries = loadContactInquiries;
  window.exportContactInquiries = exportContactInquiries;
  formFilter.addEventListener('change', render);
  statusFilter.addEventListener('change', render);
  searchInput.addEventListener('input', render);
})();
