/**
 * HPのお問い合わせフォーム送信処理。
 * 対象：form[data-contact-form]（値は general＝お問い合わせページ / consulting＝サービスページのコンサル相談）。
 * サーバーの /api/contact/inquiries に送信し、DBへの保存・社内通知・受付確認メールはサーバー側で行う。
 */
(function () {
  'use strict';

  /**
   * 二重送信を防ぐための送信識別子を作る。同じ識別子の再送はサーバーで1件として扱われる。
   * @returns {string} 英数字・ハイフン・アンダースコアのみの文字列
   */
  function newSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `c_${window.crypto.randomUUID()}`;
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return `c_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  /**
   * フォーム1つ分の送信処理を設定する。
   * @param {HTMLFormElement} form 対象のフォーム
   */
  function setupForm(form) {
    const formType = form.dataset.contactForm;
    const status = form.parentElement.querySelector('[data-contact-status]');
    const complete = form.parentElement.querySelector('[data-contact-complete]');
    const submit = form.querySelector('[type="submit"]');
    const submitLabel = submit ? submit.innerHTML : '';
    // フォームを開くたびに識別子を1つ発行し、送信が成功するまで同じ値を使う（通信エラー後の再送も1件になる）
    let submissionId = newSubmissionId();
    // 送信中にEnterキーなどで再度送信されるのを防ぐ（サーバー側でも同じ識別子は1件として扱う）
    let submitting = false;

    /**
     * フォーム上部に状況メッセージを表示する。
     * @param {string} message 表示する文言（空文字で非表示）
     * @param {boolean} isError エラーとして目立たせるか
     */
    function showStatus(message, isError) {
      if (!status) return;
      status.textContent = message;
      status.hidden = !message;
      status.classList.toggle('is-error', Boolean(isError));
    }

    /**
     * 入力欄の値を前後の空白を除いて取り出す。
     * @param {string} name 入力欄の name 属性
     * @returns {string} 入力値（欄がなければ空文字）
     */
    function value(name) {
      const field = form.elements.namedItem(name);
      return field && typeof field.value === 'string' ? field.value.trim() : '';
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitting || !form.reportValidity()) return;
      const consent = form.elements.namedItem('privacy_consent');
      const payload = {
        client_submission_id: submissionId,
        website: value('website'),
        form_type: formType,
        name: value('name'),
        email: value('email'),
        phone: value('phone'),
        company: value('company'),
        occupation: value('occupation'),
        inquiry_type: value('inquiry_type'),
        message: value('message'),
        privacy_consent: Boolean(consent && consent.checked),
        page_url: window.location.href.split('#')[0]
      };

      submitting = true;
      if (submit) {
        submit.disabled = true;
        submit.textContent = '送信中…';
      }
      showStatus('', false);
      try {
        const response = await fetch('/api/contact/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : null;
        if (!response.ok) {
          // 入力内容の誤り（422）はサーバーの説明をそのまま表示し、それ以外は再送を案内する
          const detail = data && typeof data.detail === 'string' ? data.detail : '';
          throw new Error(response.status === 422 && detail
            ? detail
            : '送信できませんでした。時間をおいて再度お試しいただくか、info@symmetrylab.jp へメールでご連絡ください。');
        }
        form.reset();
        submissionId = newSubmissionId();
        form.hidden = true;
        if (complete) {
          complete.hidden = false;
          complete.focus();
        }
      } catch (error) {
        const offline = error instanceof TypeError;
        showStatus(offline
          ? '通信できませんでした。インターネット接続をご確認のうえ、もう一度送信してください。'
          : error.message, true);
      } finally {
        submitting = false;
        if (submit) {
          submit.disabled = false;
          submit.innerHTML = submitLabel;
        }
      }
    });

    // 送信完了後に「続けてお問い合わせする」を押したら、空のフォームに戻す
    const again = complete && complete.querySelector('[data-contact-again]');
    if (again) {
      again.addEventListener('click', () => {
        complete.hidden = true;
        form.hidden = false;
        showStatus('', false);
        // 先頭の隠し項目（ボット対策）ではなく、最初の入力欄にカーソルを置く
        form.querySelector('input:not([name="website"]):not([type="hidden"]), select, textarea').focus();
      });
    }
  }

  document.querySelectorAll('form[data-contact-form]').forEach(setupForm);
})();
