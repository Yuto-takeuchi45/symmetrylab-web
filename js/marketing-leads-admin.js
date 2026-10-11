(function () {
  'use strict';

  const list = document.getElementById('marketing-leads-list');
  if (!list) return;

  const statusMessage = document.getElementById('lead-status-message');
  const sourceFilter = document.getElementById('lead-source-filter');
  const statusFilter = document.getElementById('lead-status-filter');
  const searchInput = document.getElementById('lead-search');
  const labels = {
    new: '新規',
    contacted: '連絡済み',
    qualified_candidate: '有効候補者',
    agent_referral: '紹介済み',
    interview: '選考中',
    joined: '入社',
    closed: '終了',
    rejected: '対象外'
  };
  const statusChoices = {
    google: [
      ['new', '新規'], ['contacted', '連絡済み'], ['qualified_candidate', '有効候補者'],
      ['agent_referral', '紹介済み'], ['interview', '選考中'], ['joined', '入社'], ['closed', '終了']
    ],
    instagram: [['new', '新規'], ['contacted', '連絡済み'], ['closed', '終了'], ['rejected', '対象外']]
  };
  let leads = [];

  function setMessage(message, isError) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle('is-error', Boolean(isError));
  }

  function textCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text || '—';
    return cell;
  }

  function smallText(parent, text) {
    if (!text) return;
    const small = document.createElement('small');
    small.textContent = text;
    parent.appendChild(small);
  }

  function displayDate(value) {
    if (!value) return '—';
    const date = parseDate(value);
    if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function parseDate(value) {
    const text = String(value || '');
    // The Google lead API historically stores server-local/UTC timestamps without an offset.
    return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  }

  function sourceKind(application, kind) {
    if (kind === 'instagram') return 'instagram';
    const source = String(application.source || '').toLowerCase();
    const utmSource = String(application.utm_source || '').toLowerCase();
    const utmMedium = String(application.utm_medium || '').toLowerCase();
    if (application.gclid || application.gbraid || application.wbraid
      || source.includes('google') || utmSource.includes('google')
      || utmMedium === 'cpc' || utmMedium === 'ppc') return 'google';
    if (kind === 'instagram' || application.fbclid || application.meta_campaign_id
      || application.meta_ad_id || source.includes('instagram') || source.includes('meta')
      || /instagram|facebook|meta/.test(utmSource)
      || /paid_social|social_paid/.test(utmMedium)) return 'instagram';
    return 'other';
  }

  function landingPath(value) {
    if (!value) return '';
    try { return new URL(value, window.location.origin).pathname; }
    catch (_error) { return String(value).split('?')[0]; }
  }

  function normalizeGoogle(application) {
    const campaign = application.utm_campaign || '';
    const appointmentMode = application.appointment_mode === 'selected'
      ? '空き日程から選択'
      : application.appointment_mode === 'later' ? '後日調整' : '未入力';
    const details = [
      ['希望領域', application.industry],
      ['希望職種', application.job],
      ['経験', application.experience],
      ['希望年収', application.income],
      ['希望勤務地', application.area],
      ['転職希望時期', application.timing],
      ['現在の活動状況', application.activity_status],
      ['相談希望日時', application.appointment_mode === 'selected' ? application.appointment : appointmentMode],
      ['日時の選択方法', appointmentMode],
      ['相談内容', application.message],
      ['個人情報の取扱いへの同意', application.consent_at ? '同意済み' : '記録なし'],
      ['同意日時', application.consent_at],
      ['同意したポリシー版', application.privacy_policy_version]
    ];
    return {
      kind: 'google',
      applicationId: application.application_id,
      createdAt: application.created_at,
      name: application.name,
      email: application.email,
      phone: application.phone,
      sourceKind: sourceKind(application, 'google'),
      sourceLabel: sourceKind(application, 'google') === 'google' ? 'Google広告' : (application.source || 'その他・不明'),
      source: application.source,
      utmSource: application.utm_source,
      utmMedium: application.utm_medium,
      campaign: campaign,
      term: application.utm_term,
      content: application.utm_content,
      metaCampaignId: '',
      metaAdsetId: '',
      metaAdId: '',
      clickIdPresent: Boolean(application.gclid || application.gbraid || application.wbraid),
      landingPage: landingPath(application.landing_page),
      status: application.application_status || 'new',
      notes: application.admin_notes || '',
      details: details
    };
  }

  function normalizeInstagram(application) {
    const answers = application.answers || {};
    const job = application.job_snapshot || {};
    const intention = application.intention === 'soon' ? '早めに転職を検討' : '情報収集';
    const details = [
      ['検討状況', intention],
      ['対象求人', job.title || application.job_public_id || '共通キャリアチェック'],
      ['求人ID', application.job_public_id],
      ['求人情報の版', application.job_version],
      ['転職希望時期', answers.q2_timing],
      ['現在の年収', answers.q3_income],
      ['最終学歴', answers.q5_education],
      ['重視すること', answers.q8_priority],
      ['年齢', answers.q10_age || application.age_band],
      ['個人情報の取扱いへの同意', application.privacy_consent_at ? '同意済み' : '記録なし'],
      ['同意日時', application.privacy_consent_at],
      ['同意したポリシー版', application.consent_version]
    ];
    return {
      kind: 'instagram',
      applicationId: application.application_id,
      createdAt: application.created_at,
      name: application.name,
      email: application.email,
      phone: application.phone,
      sourceKind: sourceKind(application, 'instagram'),
      sourceLabel: 'Instagram LP',
      source: application.source,
      utmSource: application.utm_source,
      utmMedium: application.utm_medium,
      campaign: application.utm_campaign || '',
      term: application.utm_term || '',
      content: application.utm_content || '',
      metaCampaignId: application.meta_campaign_id || '',
      metaAdsetId: application.meta_adset_id || '',
      metaAdId: application.meta_ad_id || '',
      placement: application.meta_placement || '',
      landingPage: landingPath(application.landing_page),
      status: application.application_status || 'new',
      notes: application.admin_notes || '',
      details: details
    };
  }

  function addDetails(cell, details) {
    if (!details.length) return;
    const disclosure = document.createElement('details');
    disclosure.className = 'lead-details';
    const summary = document.createElement('summary');
    summary.textContent = 'フォーム回答をすべて見る';
    const listElement = document.createElement('ul');
    details.forEach(([label, value]) => {
      const item = document.createElement('li');
      item.textContent = `${label}：${value === null || value === undefined || value === '' ? '未入力' : value}`;
      listElement.appendChild(item);
    });
    disclosure.append(summary, listElement);
    cell.appendChild(disclosure);
  }

  function currentLeads() {
    const selectedSource = sourceFilter.value;
    const selectedStatus = statusFilter.value;
    const query = searchInput.value.trim().toLowerCase();
    return leads.filter((lead) => {
      if (selectedSource && lead.sourceKind !== selectedSource) return false;
      if (selectedStatus && lead.status !== selectedStatus) return false;
      if (!query) return true;
      return [lead.name, lead.email, lead.phone, lead.campaign, lead.utmSource,
        lead.utmMedium, lead.term, lead.content, lead.placement, lead.sourceLabel,
        lead.landingPage, lead.applicationId].join(' ').toLowerCase().includes(query);
    });
  }

  function render() {
    const visible = currentLeads();
    document.getElementById('lead-count-total').textContent = leads.length.toLocaleString('ja-JP');
    document.getElementById('lead-count-instagram').textContent = leads.filter((lead) => lead.kind === 'instagram').length.toLocaleString('ja-JP');
    document.getElementById('lead-count-google').textContent = leads.filter((lead) => lead.kind === 'google').length.toLocaleString('ja-JP');
    list.replaceChildren();

    if (!visible.length) {
      const row = document.createElement('tr');
      const empty = document.createElement('td');
      empty.className = 'lead-empty';
      empty.colSpan = 7;
      empty.textContent = leads.length ? '条件に一致する申込はありません。' : '申込はありません。';
      row.appendChild(empty);
      list.appendChild(row);
      return;
    }

    visible.forEach((lead) => {
      const row = document.createElement('tr');
      row.appendChild(textCell(displayDate(lead.createdAt)));

      const sourceCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `lead-source${lead.sourceKind === 'google' ? ' google' : lead.sourceKind === 'other' ? ' other' : ''}`;
      badge.textContent = lead.sourceLabel;
      sourceCell.appendChild(badge);
      const attribution = [
        lead.utmSource && `source: ${lead.utmSource}`,
        lead.utmMedium && `medium: ${lead.utmMedium}`,
        lead.campaign && `campaign: ${lead.campaign}`,
        lead.term && `term: ${lead.term}`,
        lead.content && `content/ad: ${lead.content}`,
        lead.metaCampaignId && `Meta campaign ID: ${lead.metaCampaignId}`,
        lead.metaAdsetId && `ad set ID: ${lead.metaAdsetId}`,
        lead.metaAdId && `Meta ad ID: ${lead.metaAdId}`,
        lead.placement && `placement: ${lead.placement}`,
        lead.clickIdPresent && 'クリックID取得済み'
      ].filter(Boolean).join(' / ');
      smallText(sourceCell, attribution || '広告情報なし');
      smallText(sourceCell, `LP: ${lead.landingPage || '不明'}`);
      row.appendChild(sourceCell);

      const applicantCell = document.createElement('td');
      applicantCell.textContent = lead.name || '—';
      smallText(applicantCell, lead.email);
      smallText(applicantCell, lead.phone);
      row.appendChild(applicantCell);

      const detailCell = document.createElement('td');
      addDetails(detailCell, lead.details);
      row.appendChild(detailCell);

      const statusCell = document.createElement('td');
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${lead.name || '申込'}の対応状況`);
      statusChoices[lead.kind].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = lead.status === value;
        select.appendChild(option);
      });
      if (!statusChoices[lead.kind].some(([value]) => value === lead.status)) {
        const option = document.createElement('option');
        option.value = lead.status;
        option.textContent = labels[lead.status] || lead.status;
        option.selected = true;
        select.appendChild(option);
      }
      statusCell.appendChild(select);
      row.appendChild(statusCell);

      const notesCell = document.createElement('td');
      const notes = document.createElement('textarea');
      notes.value = lead.notes;
      notes.setAttribute('aria-label', `${lead.name || '申込'}の管理メモ`);
      notesCell.appendChild(notes);
      row.appendChild(notesCell);

      const actionCell = document.createElement('td');
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'lead-save';
      save.textContent = '保存';
      save.addEventListener('click', async () => {
        const key = sessionStorage.getItem('adminKey') || '';
        if (!key) {
          setMessage('管理画面にログインしてください。', true);
          return;
        }
        save.disabled = true;
        save.textContent = '保存中';
        try {
          const endpoint = lead.kind === 'google' ? 'consulting-career' : 'ad-creative';
          const response = await fetch(`/api/admin/${endpoint}/applications/${encodeURIComponent(lead.applicationId)}`, {
            method: 'PATCH',
            headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ status: select.value, admin_notes: notes.value })
          });
          const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
          if (!response.ok) throw new Error(data?.detail || '更新できませんでした。');
          lead.status = select.value;
          lead.notes = notes.value;
          setMessage(`${lead.name || '申込'}の対応状況を保存しました。`, false);
          render();
        } catch (error) {
          setMessage(error.message || '更新できませんでした。', true);
          save.disabled = false;
          save.textContent = '保存';
        }
      });
      actionCell.appendChild(save);
      row.appendChild(actionCell);
      list.appendChild(row);
    });
  }

  async function loadMarketingLeads() {
    const key = sessionStorage.getItem('adminKey') || '';
    if (!key) {
      setMessage('先に管理画面へログインしてください。', true);
      return;
    }
    setMessage('申込を読み込んでいます…', false);
    try {
      const headers = { 'X-Admin-Key': key, 'Accept': 'application/json' };
      async function fetchAllPages(endpoint) {
        const pageSize = 500;
        const applications = [];
        let offset = 0;
        while (true) {
          const response = await fetch(`${endpoint}?limit=${pageSize}&offset=${offset}`, { headers });
          const data = await response.json();
          if (!response.ok) throw new Error(data?.detail || '申込データを読み込めませんでした。');
          if (!Array.isArray(data)) throw new Error('申込データの形式が正しくありません。');
          applications.push(...data);
          if (data.length < pageSize) return applications;
          offset += data.length;
        }
      }
      const [googleData, instagramData] = await Promise.all([
        fetchAllPages('/api/admin/consulting-career/applications'),
        fetchAllPages('/api/admin/ad-creative/applications')
      ]);
      leads = [
        ...googleData.map(normalizeGoogle),
        ...instagramData.map(normalizeInstagram)
      ].sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt));
      render();
      setMessage(`${leads.length.toLocaleString('ja-JP')}件を読み込みました（全件）。`, false);
    } catch (error) {
      leads = [];
      render();
      setMessage(error.message || '申込データを読み込めませんでした。', true);
    }
  }

  window.loadMarketingLeads = loadMarketingLeads;
  sourceFilter.addEventListener('change', render);
  statusFilter.addEventListener('change', render);
  searchInput.addEventListener('input', render);
})();
