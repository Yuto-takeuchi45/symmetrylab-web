(function () {
  "use strict";

  const hero = document.getElementById("job-hero");
  const jobList = document.getElementById("job-list");
  const jobListGrid = document.getElementById("job-list-grid");
  const detailContent = document.getElementById("job-detail-content");
  const unavailablePanel = document.getElementById("unavailable-panel");
  const startButton = document.getElementById("start-application");
  const applicationPanel = document.getElementById("application-panel");
  const form = document.getElementById("recruitment-form");
  const stepContent = document.getElementById("step-content");
  const stepBack = document.getElementById("step-back");
  const stepNext = document.getElementById("step-next");
  const progressLabel = document.getElementById("progress-label");
  const stepCounter = document.getElementById("step-counter");
  const progressValue = document.getElementById("progress-value");
  const statusPanel = document.getElementById("status-panel");
  const statusTitle = document.getElementById("status-title");
  const statusMessage = document.getElementById("status-message");

  const questions = [
    {
      id: "timing",
      label: "転職希望時期を教えてください",
      help: "今の時点での目安で構いません。",
      type: "choice",
      options: ["すぐに", "3カ月以内", "3〜6カ月以内", "6カ月〜1年以内", "1年以上先", "時期未定"]
    },
    {
      id: "current_job",
      label: "現在の職種を教えてください",
      help: "例：法人営業、経理、エンジニアなど",
      type: "text",
      placeholder: "現在の職種"
    },
    {
      id: "experience_years",
      label: "社会人経験年数を教えてください",
      help: "転職回数ではなく、社会人としての経験年数です。",
      type: "choice",
      options: ["1年未満", "1〜3年", "4〜6年", "7〜10年", "11年以上"]
    },
    {
      id: "preferred_location",
      label: "希望勤務地を教えてください",
      help: "求人により条件が異なるため、希望を確認します。",
      type: "choice",
      options: ["東京23区", "東京近郊", "大阪", "その他の地域", "全国可", "未定"]
    },
    {
      id: "age",
      label: "年齢を教えてください",
      help: "応募可否の確認に使用します。",
      type: "number",
      placeholder: "年齢"
    },
    {
      id: "name",
      label: "氏名を教えてください",
      help: "担当者からのご案内に使用します。",
      type: "text",
      placeholder: "氏名"
    },
    {
      id: "phone",
      label: "電話番号を教えてください",
      help: "連絡可能な番号を入力してください。",
      type: "tel",
      placeholder: "090-0000-0000"
    },
    {
      id: "email",
      label: "メールアドレスを教えてください",
      help: "求人詳細と今後の進め方をご案内します。",
      type: "email",
      placeholder: "name@example.com"
    }
  ];

  const state = {
    jobs: [],
    job: null,
    step: 0,
    answers: {},
    started: false,
    submitting: false,
    clientSubmissionId: createSubmissionId()
  };

  function createSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "recruitment-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setList(container, values) {
    container.replaceChildren();
    (Array.isArray(values) ? values : []).forEach(function (value) {
      const item = makeElement("li", "", value || "要確定");
      container.appendChild(item);
    });
    if (!container.children.length) {
      container.appendChild(makeElement("li", "", "要確定"));
    }
  }

  function renderJobFacts(job) {
    const facts = [
      ["職種", job.job_type],
      ["勤務地", job.location],
      ["想定年収", job.salary],
      ["年間休日", job.annual_holidays],
      ["雇用形態", job.employment_type],
      ["賞与", job.bonus],
      ["リモート", job.remote],
      ["転勤", job.relocation],
      ["未経験", job.inexperienced_ok]
    ];
    const factsContainer = document.getElementById("job-facts");
    factsContainer.replaceChildren();
    facts.forEach(function (fact) {
      const card = makeElement("dl", "detail-card");
      card.appendChild(makeElement("dt", "", fact[0]));
      card.appendChild(makeElement("dd", "", fact[1] || "要確定"));
      factsContainer.appendChild(card);
    });
  }

  function renderJob(job) {
    state.job = job;
    const applicationEligible = isApplicationEligible(job);
    hero.hidden = false;
    jobList.hidden = true;
    detailContent.hidden = false;
    unavailablePanel.hidden = true;
    document.getElementById("job-eyebrow").textContent = job.job_type || "RECRUITMENT";
    document.getElementById("job-title").textContent = job.title || "求人詳細";
    document.getElementById("job-catch-copy").textContent = job.catch_copy || job.summary || "求人の詳細をご確認ください。";
    const sampleNote = document.getElementById("sample-note");
    sampleNote.hidden = applicationEligible;
    sampleNote.textContent = job.is_sample
      ? "掲載準備用のサンプル求人です。フォームはプレビュー専用で、送信は無効です。"
      : "現在この求人は応募を受け付けていません。";
    document.getElementById("start-application").hidden = false;
    document.getElementById("start-application").textContent = applicationEligible
      ? "この求人について相談する"
      : "フォームをプレビューする";
    document.title = (job.title || "求人詳細") + " | SYMMETRY Lab";

    renderJobFacts(job);
    setList(document.getElementById("job-features"), job.company_features);
    setList(document.getElementById("job-responsibilities"), job.responsibilities);
    setList(document.getElementById("job-requirements"), job.requirements);
    setList(document.getElementById("job-preferred"), job.preferred);
    setList(document.getElementById("job-highlights"), job.highlights);
    document.getElementById("preferred-section").hidden = !(job.preferred && job.preferred.length);

    if (window.SymmetryRecruitmentTracking) {
      window.SymmetryRecruitmentTracking.init(job);
    }
  }

  function renderJobList(jobs) {
    jobListGrid.replaceChildren();
    jobs.forEach(function (job) {
      const link = makeElement("a", "job-card");
      link.href = "/jobs/" + encodeURIComponent(job.public_id || job.job_id || job.slug) + "/";
      link.appendChild(makeElement("small", "", job.is_sample ? "SAMPLE JOB" : "OPEN ROLE"));
      link.appendChild(makeElement("h3", "", job.title || "求人詳細"));
      link.appendChild(makeElement("p", "", job.summary || "求人の詳細を確認する"));
      jobListGrid.appendChild(link);
    });
    hero.hidden = false;
    jobList.hidden = false;
    detailContent.hidden = true;
    unavailablePanel.hidden = true;
    startButton.hidden = true;
    document.getElementById("job-eyebrow").textContent = "RECRUITMENT";
    document.getElementById("job-title").textContent = "気になる求人を選ぶ";
    document.getElementById("job-catch-copy").textContent = "Instagram広告からの求人詳細を、求人ごとの専用ページで確認できます。";
    document.getElementById("sample-note").hidden = true;
    document.title = "求人一覧 | SYMMETRY Lab";
  }

  function showUnavailable() {
    hero.hidden = true;
    jobList.hidden = true;
    detailContent.hidden = true;
    applicationPanel.hidden = true;
    unavailablePanel.hidden = false;
  }

  function isApplicationEligible(job) {
    return Boolean(
      job
      && job.status === "published"
      && job.application_enabled === true
      && job.is_sample !== true
    );
  }

  function showPreviewOnly() {
    applicationPanel.hidden = false;
    form.hidden = true;
    statusPanel.hidden = false;
    statusTitle.textContent = "プレビューを確認しました";
    statusMessage.textContent = "この求人は送信できません。承認済みの求人を公開し、application_enabled を true にしてから受付を開始してください。";
    applicationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startApplication() {
    if (!state.job) return;
    if (!isApplicationEligible(state.job)) {
      showPreviewOnly();
      return;
    }
    if (state.started) {
      applicationPanel.hidden = false;
      applicationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    state.started = true;
    applicationPanel.hidden = false;
    renderStep();
    if (window.SymmetryRecruitmentTracking) {
      window.SymmetryRecruitmentTracking.trackStartRegistration(state.job);
    }
    applicationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function currentQuestion() {
    return questions[state.step];
  }

  function updateProgress() {
    const isConsentStep = state.step >= questions.length;
    progressLabel.textContent = isConsentStep ? "内容確認と同意" : "プロフィールを確認";
    stepCounter.textContent = isConsentStep ? "確認 / 8" : (state.step + 1) + " / 8";
    progressValue.style.width = (isConsentStep ? 100 : ((state.step + 1) / questions.length) * 100) + "%";
    stepBack.disabled = state.step === 0 || state.submitting;
    stepNext.textContent = isConsentStep ? "送信する" : "次へ";
  }

  function inputForQuestion(question) {
    const input = document.createElement("input");
    input.className = "field-input";
    input.id = "question-" + question.id;
    input.name = question.id;
    input.type = question.type === "number" ? "number" : question.type;
    input.placeholder = question.placeholder || "";
    input.autocomplete = question.id === "name" ? "name" : question.id === "email" ? "email" : question.id === "phone" ? "tel" : "off";
    if (question.type === "number") {
      input.min = "18";
      input.max = "80";
      input.inputMode = "numeric";
    }
    input.value = state.answers[question.id] || "";
    input.addEventListener("input", function () {
      state.answers[question.id] = input.value;
    });
    return input;
  }

  function renderStep() {
    updateProgress();
    stepContent.replaceChildren();
    statusPanel.hidden = true;

    if (state.step >= questions.length) {
      renderConsentStep();
      return;
    }

    const question = currentQuestion();
    const card = makeElement("section", "question-card");
    card.setAttribute("aria-labelledby", "question-title");
    const questionTitle = makeElement("h3", "", question.label);
    questionTitle.id = "question-title";
    card.appendChild(questionTitle);
    card.appendChild(makeElement("p", "question-help", question.help));

    if (question.type === "choice") {
      const choices = makeElement("div", "choice-list");
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-label", question.label);
      question.options.forEach(function (option) {
        const button = makeElement("button", "choice-button", option);
        button.type = "button";
        button.setAttribute("aria-pressed", state.answers[question.id] === option ? "true" : "false");
        button.addEventListener("click", function () {
          state.answers[question.id] = option;
          state.step += 1;
          renderStep();
        });
        choices.appendChild(button);
      });
      card.appendChild(choices);
    } else {
      const label = makeElement("label", "field-label", question.placeholder || question.label);
      label.htmlFor = "question-" + question.id;
      card.appendChild(label);
      const input = inputForQuestion(question);
      card.appendChild(input);
      card.appendChild(makeElement("p", "field-error", ""));
      window.setTimeout(function () { input.focus(); }, 0);
    }
    stepContent.appendChild(card);
  }

  function renderConsentStep() {
    const review = makeElement("dl", "review-list");
    [
      ["求人", state.job && state.job.title],
      ["転職希望時期", state.answers.timing],
      ["現在の職種", state.answers.current_job],
      ["希望勤務地", state.answers.preferred_location],
      ["氏名", state.answers.name],
      ["連絡先", state.answers.email]
    ].forEach(function (item) {
      const row = makeElement("div");
      row.appendChild(makeElement("dt", "", item[0]));
      row.appendChild(makeElement("dd", "", item[1] || "—"));
      review.appendChild(row);
    });
    stepContent.appendChild(review);

    const card = makeElement("section", "question-card");
    card.appendChild(makeElement("h3", "", "内容を確認して送信してください"));
    card.appendChild(makeElement("p", "question-help", "送信後、担当者より求人詳細と応募可否をご案内します。"));
    const consentBox = makeElement("div", "consent-box");

    const privacyLabel = makeElement("label", "consent-row");
    const privacyInput = document.createElement("input");
    privacyInput.type = "checkbox";
    privacyInput.id = "privacy-consent";
    privacyInput.checked = Boolean(state.answers.privacy_consent);
    privacyInput.addEventListener("change", function () { state.answers.privacy_consent = privacyInput.checked; });
    privacyLabel.appendChild(privacyInput);
    const privacyText = makeElement("span");
    privacyText.appendChild(document.createTextNode("プライバシーポリシーを確認し、個人情報の取扱いに同意します（必須）"));
    privacyText.appendChild(document.createTextNode(" "));
    const privacyLink = makeElement("a", "", "内容を見る");
    privacyLink.href = "/privacy.html";
    privacyLink.target = "_blank";
    privacyLink.rel = "noopener";
    privacyText.appendChild(privacyLink);
    privacyLabel.appendChild(privacyText);
    consentBox.appendChild(privacyLabel);

    const partnerLabel = makeElement("label", "consent-row");
    const partnerInput = document.createElement("input");
    partnerInput.type = "checkbox";
    partnerInput.id = "partner-consent";
    partnerInput.checked = Boolean(state.answers.partner_consent);
    partnerInput.addEventListener("change", function () { state.answers.partner_consent = partnerInput.checked; });
    partnerLabel.appendChild(partnerInput);
    partnerLabel.appendChild(makeElement("span", "", "提携する職業紹介事業者へ情報を共有する可能性があること、その利用目的の説明を確認しました（必須）"));
    consentBox.appendChild(partnerLabel);
    card.appendChild(consentBox);
    card.appendChild(makeElement("p", "field-error", ""));
    stepContent.appendChild(card);
  }

  function syncCurrentInput() {
    if (state.step >= questions.length) return;
    const question = currentQuestion();
    const input = document.getElementById("question-" + question.id);
    if (input) state.answers[question.id] = input.value;
  }

  function validationMessage() {
    const question = currentQuestion();
    const value = String(state.answers[question.id] || "").trim();
    if (!value) return "入力してください。";
    if (question.id === "age" && (!/^\d+$/.test(value) || Number(value) < 18 || Number(value) > 80)) return "18〜80の数字で入力してください。";
    if (question.id === "phone" && value.replace(/[^0-9]/g, "").length < 7) return "電話番号の形式を確認してください。";
    if (question.id === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "メールアドレスの形式を確認してください。";
    if (question.id === "current_job" && value.length > 120) return "120文字以内で入力してください。";
    return "";
  }

  function showCurrentError(message) {
    const error = stepContent.querySelector(".field-error");
    if (error) error.textContent = message;
  }

  function validateConsent() {
    if (state.answers.privacy_consent && state.answers.partner_consent) return true;
    showCurrentError("2つの同意項目を確認してください。");
    return false;
  }

  async function submitApplication() {
    if (state.submitting || !state.job) return;
    if (!isApplicationEligible(state.job)) {
      showPreviewOnly();
      return;
    }
    if (!validateConsent()) return;
    state.submitting = true;
    updateProgress();
    stepNext.textContent = "送信中…";

    const tracking = window.SymmetryRecruitmentTracking;
    const attribution = tracking ? tracking.getAttribution() : {};
    const payload = Object.assign({
      client_submission_id: state.clientSubmissionId,
      website: document.getElementById("website").value,
      job_slug: state.job.slug,
      name: String(state.answers.name || "").trim(),
      email: String(state.answers.email || "").trim(),
      phone: String(state.answers.phone || "").trim(),
      age: Number(state.answers.age),
      current_job: String(state.answers.current_job || "").trim(),
      experience_years: state.answers.experience_years || "",
      preferred_location: state.answers.preferred_location || "",
      timing: state.answers.timing || "",
      privacy_consent: Boolean(state.answers.privacy_consent),
      partner_consent: Boolean(state.answers.partner_consent),
      landing_page: window.location.pathname + window.location.search
    }, attribution);

    try {
      const response = await fetch("/api/recruitment/applications", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok || !data.ok) {
        throw new Error(data.detail || "送信に失敗しました。入力内容を確認して再度お試しください。");
      }

      form.hidden = true;
      statusPanel.hidden = false;
      statusTitle.textContent = "ご登録ありがとうございます";
      statusMessage.textContent = data.duplicate
        ? "受付済みの内容を確認しました。担当者からのご連絡をお待ちください。"
        : "担当者より求人詳細・応募可否・今後の進め方をご案内します。";
      if (!data.duplicate && tracking) {
        tracking.trackLead(data.application_id || data.lead_id, state.job);
      }
    } catch (error) {
      state.submitting = false;
      updateProgress();
      stepNext.textContent = "送信する";
      showCurrentError(error.message || "送信に失敗しました。時間をおいて再度お試しください。");
    }
  }

  function goNext() {
    if (state.step >= questions.length) {
      submitApplication();
      return;
    }
    syncCurrentInput();
    const error = validationMessage();
    if (error) {
      showCurrentError(error);
      return;
    }
    state.step += 1;
    renderStep();
  }

  function goBack() {
    if (state.submitting || state.step === 0) return;
    state.step -= 1;
    renderStep();
  }

  async function loadJobs() {
    try {
      const response = await fetch("/api/recruitment/jobs", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("求人を読み込めませんでした。");
      state.jobs = await response.json();
      const params = new URLSearchParams(window.location.search);
      const pathParts = window.location.pathname.split("/").filter(Boolean);
      const jobsIndex = pathParts.indexOf("jobs");
      const recruitmentIndex = pathParts.indexOf("recruitment");
      const publicId = jobsIndex >= 0 ? pathParts[jobsIndex + 1] : "";
      const pathSlug = recruitmentIndex >= 0 ? pathParts[recruitmentIndex + 1] : "";
      const isLegacyRoot = !pathSlug || pathSlug === "index.html";
      const legacySlug = isLegacyRoot ? (params.get("job") || params.get("job_slug")) : pathSlug;
      if (!publicId && !legacySlug) {
        renderJobList(state.jobs);
        return;
      }
      const job = state.jobs.find(function (item) {
        if (publicId) return String(item.public_id || item.job_id || "") === publicId;
        return item.slug === legacySlug;
      });
      if (!job) {
        showUnavailable();
        return;
      }
      renderJob(job);
    } catch (_error) {
      showUnavailable();
    }
  }

  startButton.addEventListener("click", startApplication);
  stepNext.addEventListener("click", goNext);
  stepBack.addEventListener("click", goBack);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    goNext();
  });
  loadJobs();
})();
