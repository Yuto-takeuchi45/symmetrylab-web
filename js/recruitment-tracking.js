(function () {
  "use strict";

  const STORAGE_KEY = "symmetrylab_recruitment_attribution_v1";
  const ATTRIBUTION_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "meta_campaign_id",
    "meta_adset_id",
    "meta_ad_id",
    "meta_placement"
  ];
  const MAX_VALUE_LENGTH = 500;
  let attribution = readAttribution();
  let bootstrapPromise = null;
  let metaConfig = { enabled: false, pixelId: "" };
  let metaReady = false;
  let pageViewSent = false;
  let viewedJobSlug = "";
  const pendingLeads = new Map();
  const sentLeadIds = new Set();

  function clean(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength || MAX_VALUE_LENGTH);
  }

  function readStoredAttribution() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      return stored && typeof stored === "object" ? stored : {};
    } catch (_error) {
      return {};
    }
  }

  function readAttribution() {
    const stored = readStoredAttribution();
    const params = new URLSearchParams(window.location.search);
    const incoming = {};
    ATTRIBUTION_KEYS.forEach(function (key) {
      const value = clean(params.get(key));
      if (value) incoming[key] = value;
    });

    const now = new Date().toISOString();
    const result = {
      utm_source: clean(stored.utm_source, 200),
      utm_medium: clean(stored.utm_medium, 200),
      utm_campaign: clean(stored.utm_campaign, 200),
      utm_term: clean(stored.utm_term, 200),
      utm_content: clean(stored.utm_content, 200),
      fbclid: clean(stored.fbclid),
      meta_campaign_id: clean(stored.meta_campaign_id, 200),
      meta_adset_id: clean(stored.meta_adset_id, 200),
      meta_ad_id: clean(stored.meta_ad_id, 200),
      meta_placement: clean(stored.meta_placement, 120),
      landing_page: clean(stored.landing_page, 500),
      first_touch_at: clean(stored.first_touch_at, 80),
      last_touch_at: clean(stored.last_touch_at, 80)
    };

    if (!result.first_touch_at) result.first_touch_at = now;
    if (!result.landing_page) {
      result.landing_page = clean(window.location.pathname + window.location.search, 500);
    }
    if (Object.keys(incoming).length) {
      Object.keys(incoming).forEach(function (key) {
        result[key] = incoming[key];
      });
      result.last_touch_at = now;
    } else if (!result.last_touch_at) {
      result.last_touch_at = now;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    } catch (_error) {
      // Attribution is useful but the funnel must remain usable when storage is blocked.
    }
    return result;
  }

  function jobContext(job) {
    job = job || {};
    return {
      job_id: clean(job.public_id || job.job_id || job.application_id || job.slug, 120),
      job_slug: clean(job.slug, 80),
      content_name: clean(job.title, 200),
      content_type: "job"
    };
  }

  function validPixelId(value) {
    return /^\d{5,20}$/.test(clean(value, 20));
  }

  function installMetaPixel(pixelId) {
    if (!validPixelId(pixelId)) return Promise.resolve(false);
    if (metaReady && window.fbq) return Promise.resolve(true);

    const fbq = function () {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, arguments);
      } else {
        fbq.queue.push(arguments);
      }
    };
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
    window.fbq("init", pixelId);

    return new Promise(function (resolve) {
      const existing = document.querySelector("script[data-recruitment-meta-pixel]");
      if (existing) {
        metaReady = true;
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      script.dataset.recruitmentMetaPixel = "true";
      script.onload = function () {
        metaReady = true;
        resolve(true);
      };
      script.onerror = function () {
        // The stub keeps this failure non-blocking and prevents a broken Pixel from blocking submission.
        metaReady = true;
        resolve(true);
      };
      document.head.appendChild(script);
    });
  }

  async function bootstrap() {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = fetch("/api/recruitment/tracking-config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    })
      .then(function (response) {
        if (!response.ok) throw new Error("tracking config unavailable");
        return response.json();
      })
      .then(function (config) {
        const pixelId = validPixelId(config.meta_pixel_id) ? clean(config.meta_pixel_id, 20) : "";
        metaConfig = {
          enabled: Boolean(config.enabled && pixelId),
          pixelId: pixelId
        };
        if (!metaConfig.enabled) return false;
        return installMetaPixel(metaConfig.pixelId);
      })
      .catch(function () {
        metaConfig = { enabled: false, pixelId: "" };
        return false;
      });
    return bootstrapPromise;
  }

  function track(eventName, job, eventId) {
    if (!metaConfig.enabled || !metaReady || !window.fbq) return;
    const params = jobContext(job);
    if (eventId) {
      window.fbq("trackSingle", metaConfig.pixelId, eventName, params, { eventID: eventId });
    } else {
      window.fbq("trackSingle", metaConfig.pixelId, eventName, params);
    }
  }

  function flushPendingLeads() {
    if (!metaConfig.enabled) {
      pendingLeads.clear();
      return;
    }
    pendingLeads.forEach(function (job, applicationId) {
      if (!sentLeadIds.has(applicationId)) {
        track("Lead", job, applicationId);
        sentLeadIds.add(applicationId);
      }
      pendingLeads.delete(applicationId);
    });
  }

  window.SymmetryRecruitmentTracking = {
    getAttribution: function () {
      return Object.assign({}, attribution);
    },

    init: function (job) {
      return bootstrap().then(function () {
        if (!metaConfig.enabled) return;
        if (!pageViewSent) {
          track("PageView", job);
          pageViewSent = true;
        }
        if (job && job.slug !== viewedJobSlug) {
          track("ViewContent", job);
          viewedJobSlug = job.slug;
        }
        flushPendingLeads();
      });
    },

    trackStartRegistration: function (job) {
      return bootstrap().then(function () {
        track("StartRegistration", job);
      });
    },

    trackLead: function (applicationId, job) {
      const id = clean(applicationId, 120);
      if (!id || sentLeadIds.has(id)) return Promise.resolve();
      pendingLeads.set(id, job || {});
      return bootstrap().then(function () {
        if (!metaConfig.enabled) {
          pendingLeads.delete(id);
          return;
        }
        if (!sentLeadIds.has(id)) {
          track("Lead", job, id);
          sentLeadIds.add(id);
        }
        pendingLeads.delete(id);
      });
    }
  };
})();
