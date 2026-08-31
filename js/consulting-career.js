document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.querySelector('.career-menu-toggle');
  const nav = document.querySelector('.career-nav');
  const form = document.querySelector('#career-application-form');
  const formCard = document.querySelector('.career-form-card');
  const status = document.querySelector('#career-form-status');
  const complete = document.querySelector('#career-complete');
  const reset = document.querySelector('#career-reset');
  let isSubmitting = false;

  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      menuToggle.setAttribute('aria-expanded', String(isOpen));
      menuToggle.setAttribute('aria-label', isOpen ? 'メニューを閉じる' : 'メニューを開く');
    });
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'メニューを開く');
    }));
  }

  if (!form) return;

  const requiredFields = [
    ['career-name', '氏名を入力してください。'],
    ['career-email', '有効なメールアドレスを入力してください。'],
    ['career-phone', '電話番号を入力してください。'],
    ['career-industry', '現在の業界を選択してください。'],
    ['career-job', '現在の職種を選択してください。'],
    ['career-experience', '社会人経験年数を選択してください。'],
    ['career-income', '現在の年収帯を選択してください。'],
    ['career-timing', '転職希望時期を選択してください。'],
    ['career-status', '現在の転職活動・選考状況を選択してください。']
  ];

  const schedule = {
    calendar: document.getElementById('career-calendar'),
    grid: document.getElementById('career-calendar-grid'),
    month: document.getElementById('career-calendar-month'),
    status: document.getElementById('career-schedule-status'),
    timeSection: document.getElementById('career-time-section'),
    timeGrid: document.getElementById('career-time-grid'),
    selected: document.getElementById('career-selected-datetime'),
    appointment: document.getElementById('career-appointment'),
    skip: document.getElementById('career-schedule-skip'),
    year: new Date().getFullYear(),
    monthIndex: new Date().getMonth(),
    selectedDate: '',
    selectedTime: '',
    availableDates: [],
    blockedDates: []
  };

  const formatScheduleDate = (year, monthIndex, day) =>
    `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const setScheduleStatus = (message, isError = false) => {
    schedule.status.textContent = message;
    schedule.status.className = `career-schedule-status${isError ? ' is-error' : ''}`;
  };

  const renderScheduleCalendar = () => {
    schedule.grid.innerHTML = '';
    schedule.month.textContent = `${schedule.year}年${schedule.monthIndex + 1}月`;
    ['日', '月', '火', '水', '木', '金', '土'].forEach((day) => {
      const label = document.createElement('div');
      label.className = 'career-day-label';
      label.textContent = day;
      schedule.grid.appendChild(label);
    });
    const firstDay = new Date(schedule.year, schedule.monthIndex, 1).getDay();
    const daysInMonth = new Date(schedule.year, schedule.monthIndex + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < firstDay; i += 1) schedule.grid.appendChild(document.createElement('div'));
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(schedule.year, schedule.monthIndex, day);
      const dateString = formatScheduleDate(schedule.year, schedule.monthIndex, day);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'career-date';
      cell.textContent = day;
      const isPast = date < today;
      const isBlocked = schedule.blockedDates.includes(dateString);
      const isOutsideConfiguredDates = schedule.availableDates.length > 0 && !schedule.availableDates.includes(dateString);
      if (!isPast && !isBlocked && !isOutsideConfiguredDates) {
        cell.classList.add('is-active');
        cell.addEventListener('click', () => selectScheduleDate(dateString, cell));
      } else {
        cell.disabled = true;
      }
      if (schedule.selectedDate === dateString) cell.classList.add('is-selected');
      schedule.grid.appendChild(cell);
    }
  };

  const isConsultationTimeAvailable = (dateString, timeString) => {
    const hour = Number.parseInt(timeString.split(':')[0], 10);
    const dayOfWeek = new Date(`${dateString}T00:00:00`).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    return isWeekend ? hour >= 9 && hour <= 20 : hour >= 19 && hour < 24;
  };

  const selectScheduleDate = async (dateString, cell) => {
    schedule.grid.querySelectorAll('.career-date').forEach((dateCell) => dateCell.classList.remove('is-selected'));
    cell.classList.add('is-selected');
    schedule.selectedDate = dateString;
    schedule.selectedTime = '';
    schedule.appointment.value = '';
    schedule.selected.hidden = true;
    schedule.skip.classList.remove('is-selected');
    schedule.timeSection.hidden = false;
    schedule.timeGrid.innerHTML = '<p class="career-schedule-status">時間を読み込んでいます…</p>';
    try {
      const response = await fetch(`${window.location.origin}/api/available-dates?training_type=case_interview&date=${dateString}`);
      if (!response.ok) throw new Error('schedule');
      const data = await response.json();
      const timeSlots = (data.time_slots || []).filter((slot) => isConsultationTimeAvailable(dateString, slot.time));
      if (!timeSlots.length) {
        schedule.timeGrid.innerHTML = '<p class="career-schedule-status is-error">この日の空き時間はありません。別の日をお選びください。</p>';
        return;
      }
      schedule.timeGrid.innerHTML = '';
      timeSlots.forEach((slot) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'career-time-button';
        button.innerHTML = `${slot.time}<small>残り${slot.slots_remaining}席</small>`;
        button.addEventListener('click', () => {
          schedule.timeGrid.querySelectorAll('.career-time-button').forEach((timeButton) => timeButton.classList.remove('is-selected'));
          button.classList.add('is-selected');
          schedule.selectedTime = slot.time;
          schedule.appointment.value = `${dateString} ${slot.time}`;
          document.getElementById('career-appointment-mode').value = 'selected';
          schedule.selected.textContent = `相談希望日時：${dateString.replaceAll('-', '/')} ${slot.time}`;
          schedule.selected.hidden = false;
        });
        schedule.timeGrid.appendChild(button);
      });
    } catch (error) {
      schedule.timeGrid.innerHTML = '<p class="career-schedule-status is-error">空き時間を取得できませんでした。日時は後から調整できます。</p>';
    }
  };

  const resetScheduleSelection = () => {
    schedule.selectedDate = '';
    schedule.selectedTime = '';
    schedule.appointment.value = '';
    document.getElementById('career-appointment-mode').value = '';
    schedule.timeSection.hidden = true;
    schedule.selected.hidden = true;
    schedule.skip.classList.remove('is-selected');
    if (schedule.calendar && !schedule.calendar.hidden) renderScheduleCalendar();
  };

  const initSchedulePicker = async () => {
    if (!schedule.calendar) return;
    document.getElementById('career-calendar-prev').addEventListener('click', () => {
      schedule.monthIndex -= 1;
      if (schedule.monthIndex < 0) { schedule.monthIndex = 11; schedule.year -= 1; }
      renderScheduleCalendar();
    });
    document.getElementById('career-calendar-next').addEventListener('click', () => {
      schedule.monthIndex += 1;
      if (schedule.monthIndex > 11) { schedule.monthIndex = 0; schedule.year += 1; }
      renderScheduleCalendar();
    });
    schedule.skip.addEventListener('click', () => {
      schedule.selectedDate = '';
      schedule.selectedTime = '';
      schedule.appointment.value = '後日調整';
      document.getElementById('career-appointment-mode').value = 'later';
      schedule.timeSection.hidden = true;
      schedule.selected.textContent = '相談希望日時：後日調整';
      schedule.selected.hidden = false;
      schedule.skip.classList.add('is-selected');
      schedule.grid.querySelectorAll('.career-date').forEach((dateCell) => dateCell.classList.remove('is-selected'));
    });
    try {
      const response = await fetch(`${window.location.origin}/api/available-dates?training_type=case_interview`);
      if (!response.ok) throw new Error('schedule');
      const data = await response.json();
      schedule.availableDates = data.available_dates || [];
      schedule.blockedDates = data.blocked_dates || [];
      renderScheduleCalendar();
      schedule.calendar.hidden = false;
      setScheduleStatus('');
    } catch (error) {
      setScheduleStatus('空き日程を取得できませんでした。日時は後から調整できます。', true);
    }
  };

  initSchedulePicker();

  const clearErrors = () => {
    form.querySelectorAll('.has-error').forEach((field) => field.classList.remove('has-error'));
    form.querySelectorAll('.career-error').forEach((error) => { error.textContent = ''; });
    status.textContent = '';
    status.className = 'career-form-status';
  };

  const showError = (id, message) => {
    const input = document.getElementById(id);
    const field = input ? input.closest('.career-field') : null;
    const error = form.querySelector(`[data-error-for="${id}"]`);
    if (field) field.classList.add('has-error');
    if (error) error.textContent = message;
  };

  const submitCareerApplication = async () => {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.area = Array.from(form.querySelectorAll('input[name="area"]:checked'))
      .map((input) => input.value)
      .join('、');
    payload.consent = document.getElementById('career-consent').checked;
    const response = await fetch('/api/consulting-career/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.lead_id) {
      const detail = typeof data.detail === 'string' ? data.detail : '申込を受け付けられませんでした。';
      throw new Error(detail);
    }
    return data;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    window.SYMMETRY_CAREER_TRACKING?.trackSubmitAttempt();
    clearErrors();
    let valid = true;

    requiredFields.forEach(([id, message]) => {
      const input = document.getElementById(id);
      if (!input.value.trim()) { showError(id, message); valid = false; }
    });

    const email = document.getElementById('career-email');
    if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      showError('career-email', 'メールアドレスの形式を確認してください。');
      valid = false;
    }

    const areas = form.querySelectorAll('input[name="area"]:checked');
    if (!areas.length) { showError('career-area', '希望するコンサル領域を1つ以上選択してください。'); valid = false; }

    const consent = document.getElementById('career-consent');
    if (!consent.checked) { showError('career-consent', '個人情報の取扱いへの同意が必要です。'); valid = false; }

    if (!valid) {
      window.SYMMETRY_CAREER_TRACKING?.trackValidationError(form);
      status.textContent = '入力内容をご確認ください。';
      status.className = 'career-form-status is-error';
      const firstError = form.querySelector('.has-error input, .has-error select, .has-error textarea, .career-consent-error:not(:empty)');
      if (firstError && firstError.focus) firstError.focus();
      return;
    }

    window.SYMMETRY_CAREER_TRACKING?.prepareApplication(form);
    const submit = form.querySelector('.career-submit');
    isSubmitting = true;
    submit.disabled = true;
    submit.querySelector('.career-submit-label').hidden = true;
    submit.querySelector('.career-submit-loading').hidden = false;

    submitCareerApplication()
      .then((data) => {
        try {
          window.SYMMETRY_CAREER_TRACKING?.recordApplicationComplete(form, data.lead_id);
        } catch (trackingError) {
          console.error('career conversion tracking failed after application save', trackingError);
        }
        form.hidden = true;
        complete.hidden = false;
        formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch((error) => {
        isSubmitting = false;
        submit.disabled = false;
        submit.querySelector('.career-submit-label').hidden = false;
        submit.querySelector('.career-submit-loading').hidden = true;
        status.textContent = error.message || '送信に失敗しました。時間をおいて再度お試しください。';
        status.className = 'career-form-status is-error';
      });
  });

  reset.addEventListener('click', () => {
    isSubmitting = false;
    form.reset();
    form.hidden = false;
    complete.hidden = true;
    const submit = form.querySelector('.career-submit');
    submit.disabled = false;
    submit.querySelector('.career-submit-label').hidden = false;
    submit.querySelector('.career-submit-loading').hidden = true;
    clearErrors();
    resetScheduleSelection();
    window.SYMMETRY_CAREER_TRACKING?.resetApplication(form);
  });
});
