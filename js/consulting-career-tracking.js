(function () {
  'use strict';

  window.dataLayer = window.dataLayer || [];

  const ATTRIBUTION_STORAGE_KEY = 'symmetrylab_career_attribution_v1';
  const CLIENT_SUBMISSION_STORAGE_KEY = 'symmetrylab_career_client_submission_v1';
  const COMPLETED_SUBMISSION_STORAGE_KEY = 'symmetrylab_career_completed_submission_v1';
  const ATTRIBUTION_KEYS = [
    'gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium',
    'utm_campaign', 'utm_term', 'utm_content'
  ];
  const completedForms = new WeakMap();
  const pendingSubmissionIds = new WeakMap();
  const startedForms = new WeakSet();
  const pendingDirectEvents = [];
  const pendingAdsConversions = [];
  let directGtagReady = false;
  let directGtagLoaded = false;
  let taggingMode = 'pending';
  let trackingConfig = {};

  const getStorage = () => {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  };

  const getSessionStorage = () => {
    try {
      return window.sessionStorage;
    } catch (error) {
      return null;
    }
  };

  const createAnonymousId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const readAttribution = () => {
    const storage = getStorage();
    let stored = {};
    if (storage) {
      try {
        stored = JSON.parse(storage.getItem(ATTRIBUTION_STORAGE_KEY) || '{}') || {};
      } catch (error) {
        stored = {};
      }
    }

    const params = new URLSearchParams(window.location.search);
    const current = {};
    ATTRIBUTION_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) current[key] = value;
    });
    const now = new Date().toISOString();
    const hasCurrentCampaign = Object.keys(current).length > 0;
    const attribution = {
      ...stored,
      ...current,
      landing_page: stored.landing_page || window.location.pathname,
      first_touch_at: stored.first_touch_at || now,
      last_touch_at: hasCurrentCampaign ? now : (stored.last_touch_at || now)
    };

    if (storage) {
      try {
        storage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
      } catch (error) {
        // Attribution is helpful but must never block the form.
      }
    }
    return attribution;
  };

  const attribution = readAttribution();

  const hiddenFieldMap = {
    tracking_lead_id: 'career-tracking-lead-id',
    client_submission_id: 'career-client-submission-id',
    gclid: 'career-gclid',
    gbraid: 'career-gbraid',
    wbraid: 'career-wbraid',
    utm_source: 'career-utm-source',
    utm_medium: 'career-utm-medium',
    utm_campaign: 'career-utm-campaign',
    utm_term: 'career-utm-term',
    utm_content: 'career-utm-content',
    landing_page: 'career-landing-page',
    first_touch_at: 'career-first-touch-at',
    last_touch_at: 'career-last-touch-at'
  };

  const hydrateForm = (form, leadId = '', clientSubmissionId = '') => {
    const sessionStorage = getSessionStorage();
    const storedClientSubmissionId = sessionStorage?.getItem(CLIENT_SUBMISSION_STORAGE_KEY) || '';
    const values = {
      ...attribution,
      tracking_lead_id: leadId,
      client_submission_id: clientSubmissionId || pendingSubmissionIds.get(form) || storedClientSubmissionId
    };
    Object.entries(hiddenFieldMap).forEach(([name, id]) => {
      const field = form.elements[name] || document.getElementById(id);
      if (field) field.value = values[name] || '';
    });
  };

  const sendDirectEvent = (payload) => {
    if (!directGtagReady || typeof window.gtag !== 'function') return;
    const { event, ...parameters } = payload;
    window.gtag('event', event, parameters);
  };

  const sendAdsConversion = (transactionId) => {
    if (!transactionId) return;
    if (!directGtagReady || !directGtagLoaded || typeof window.gtag !== 'function') {
      pendingAdsConversions.push(String(transactionId));
      return;
    }
    const conversionTarget = getAdsConversionTarget();
    if (!conversionTarget) return;
    window.gtag('event', 'conversion', {
      send_to: conversionTarget,
      transaction_id: String(transactionId)
    });
  };

  const pushEvent = (event, parameters = {}) => {
    const payload = { event, ...parameters };
    if (taggingMode === 'gtm') {
      window.dataLayer.push(payload);
    } else if (taggingMode === 'direct') {
      sendDirectEvent(payload);
    } else if (taggingMode === 'pending') {
      pendingDirectEvents.push(payload);
    }
  };

  const validGtmId = (value) => /^GTM-[A-Z0-9]+$/i.test(value) && !value.includes('XXXX');
  const validGa4Id = (value) => /^G-[A-Z0-9]+$/i.test(value) && !value.includes('XXXX');
  const validAdsId = (value) => /^AW-[0-9]+$/i.test(value) && !value.includes('XXXX');
  const getAdsConversionTarget = () => {
    const adsId = String(trackingConfig.google_ads_conversion_id || '').trim();
    const label = String(trackingConfig.google_ads_conversion_label || '').trim();
    return validAdsId(adsId) && label ? `${adsId}/${label}` : '';
  };

  const loadGtm = (containerId) => {
    taggingMode = 'gtm';
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
    document.head.appendChild(script);
    pendingDirectEvents.splice(0).forEach((payload) => window.dataLayer.push(payload));
  };

  const loadDirectTags = (config) => {
    const ga4Id = validGa4Id(config.ga4_measurement_id) ? config.ga4_measurement_id : '';
    const adsId = validAdsId(config.google_ads_conversion_id) ? config.google_ads_conversion_id : '';
    if (!ga4Id && !adsId) {
      taggingMode = 'none';
      pendingDirectEvents.length = 0;
      return;
    }

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    if (ga4Id) window.gtag('config', ga4Id, { send_page_view: false });
    if (adsId) window.gtag('config', adsId);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id || adsId)}`;
    script.addEventListener('load', () => {
      directGtagLoaded = true;
      directGtagReady = true;
      taggingMode = 'direct';
      pendingDirectEvents.splice(0).forEach(sendDirectEvent);
      pendingAdsConversions.splice(0).forEach(sendAdsConversion);
    }, { once: true });
    document.head.appendChild(script);
  };

  const initialiseTagging = () => {
    fetch(`/api/tracking-config?ts=${Date.now()}`, {
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}))
      .then((config) => {
        const settings = config || {};
        trackingConfig = settings;
        window.SYMMETRY_TRACKING_CONFIG = settings;
        // Google Ads conversion is intentionally sent by the existing direct
        // gtag path whenever an Ads conversion ID is configured. This keeps
        // the post-save conversion independent of a GTM container that may
        // not contain the matching Google Ads conversion tag.
        if (validAdsId(settings.google_ads_conversion_id)) loadDirectTags(settings);
        else if (validGtmId(settings.gtm_container_id)) loadGtm(settings.gtm_container_id);
        else loadDirectTags(settings);
      });
  };

  const trackCtaClick = (element) => {
    const container = element.closest('.career-hero-actions, .career-nav, .career-cta, .career-application-intro');
    const location = container && container.classList.contains('career-nav') ? 'nav'
      : container && container.classList.contains('career-hero-actions') ? 'hero'
        : 'section';
    pushEvent('career_cta_click', {
      cta_location: location,
      cta_id: element.classList.contains('career-nav-cta') ? 'nav_consultation' : 'consultation'
    });
  };

  const trackFormStart = (form) => {
    if (startedForms.has(form)) return;
    startedForms.add(form);
    pushEvent('career_form_start', { form_id: 'career_application' });
  };

  const trackSubmitAttempt = () => {
    pushEvent('career_form_submit_attempt', { form_id: 'career_application' });
  };

  const trackValidationError = (form) => {
    pushEvent('career_form_validation_error', {
      form_id: 'career_application',
      error_count: form.querySelectorAll('.has-error').length
    });
  };

  const prepareApplication = (form) => {
    const sessionStorage = getSessionStorage();
    const completedSubmission = sessionStorage?.getItem(COMPLETED_SUBMISSION_STORAGE_KEY);
    if (completedSubmission) {
      sessionStorage.removeItem(COMPLETED_SUBMISSION_STORAGE_KEY);
      sessionStorage.removeItem(CLIENT_SUBMISSION_STORAGE_KEY);
    }
    const clientSubmissionId = pendingSubmissionIds.get(form)
      || sessionStorage?.getItem(CLIENT_SUBMISSION_STORAGE_KEY)
      || createAnonymousId();
    pendingSubmissionIds.set(form, clientSubmissionId);
    sessionStorage?.setItem(CLIENT_SUBMISSION_STORAGE_KEY, clientSubmissionId);
    hydrateForm(form, '', clientSubmissionId);
    return clientSubmissionId;
  };

  const recordApplicationComplete = (form, serverLeadId) => {
    if (!serverLeadId) return null;
    if (completedForms.has(form)) return completedForms.get(form);
    const clientSubmissionId = pendingSubmissionIds.get(form) || prepareApplication(form);
    completedForms.set(form, serverLeadId);
    getSessionStorage()?.setItem(COMPLETED_SUBMISSION_STORAGE_KEY, serverLeadId);
    hydrateForm(form, serverLeadId, clientSubmissionId);
    const appointmentMode = (form.elements.appointment_mode && form.elements.appointment_mode.value) || 'later';
    const parameters = {
      form_id: 'career_application',
      lead_id: serverLeadId,
      event_id: serverLeadId,
      appointment_mode: appointmentMode,
      attribution_source: attribution.utm_source || (attribution.gclid ? 'google_ads' : 'direct'),
      gclid: attribution.gclid || '',
      gbraid: attribution.gbraid || '',
      wbraid: attribution.wbraid || '',
      utm_source: attribution.utm_source || '',
      utm_medium: attribution.utm_medium || '',
      utm_campaign: attribution.utm_campaign || '',
      utm_term: attribution.utm_term || '',
      utm_content: attribution.utm_content || ''
    };
    pushEvent('generate_lead', parameters);
    sendAdsConversion(serverLeadId);
    return serverLeadId;
  };

  const resetApplication = (form) => {
    completedForms.delete(form);
    pendingSubmissionIds.delete(form);
    const sessionStorage = getSessionStorage();
    sessionStorage?.removeItem(CLIENT_SUBMISSION_STORAGE_KEY);
    sessionStorage?.removeItem(COMPLETED_SUBMISSION_STORAGE_KEY);
    hydrateForm(form);
  };

  window.SYMMETRY_CAREER_TRACKING = {
    hydrateForm,
    trackFormStart,
    trackSubmitAttempt,
    trackValidationError,
    prepareApplication,
    recordApplicationComplete,
    resetApplication,
    getAttribution: () => ({ ...attribution })
  };

  pushEvent('career_lp_view', { page_type: 'consulting_career' });
  initialiseTagging();

  const onReady = (callback) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  };

  onReady(() => {
    const form = document.getElementById('career-application-form');
    if (form) {
      hydrateForm(form);
      form.addEventListener('focusin', () => trackFormStart(form), { once: false });
      form.addEventListener('input', () => trackFormStart(form), { once: false });
    }
    document.addEventListener('click', (event) => {
      const cta = event.target.closest('a[href="#application"]');
      if (cta) trackCtaClick(cta);
    });
  });
})();
