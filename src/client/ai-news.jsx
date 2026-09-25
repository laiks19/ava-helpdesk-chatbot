import React, { useEffect, useState } from "react";

export function AiNews({ api }) {
  const [feed, setFeed] = useState({ items: [], lastRefresh: null, loading: true, error: "" });

  useEffect(() => {
    let active = true;
    api.aiNews()
      .then((data) => {
        if (active) setFeed({ items: data.items || [], lastRefresh: data.lastRefresh || null, loading: false, error: "" });
      })
      .catch((error) => {
        if (active) setFeed({ items: [], lastRefresh: null, loading: false, error: error.message });
      });
    return () => { active = false; };
  }, [api]);

  const [lead] = feed.items;

  return (
    <section className="ai-news-band" aria-labelledby="ai-news-title">
      <div className="ai-news-inner">
        <div className="ai-news-heading">
          <div>
            <span className="section-kicker">Daily briefing</span>
            <h2 id="ai-news-title">Latest AI Updates</h2>
            <p>Selected updates from official AI company newsrooms, refreshed every morning.</p>
          </div>
          {feed.lastRefresh?.finishedAt ? <span className="news-refreshed">Updated {formatNewsDate(feed.lastRefresh.finishedAt)}</span> : null}
        </div>

        {feed.loading ? <p className="news-state">Loading today's AI briefing...</p> : null}
        {feed.error ? <p className="news-state">The AI news briefing is temporarily unavailable.</p> : null}
        {feed.lastRefresh?.status === "failed" ? <p className="news-state news-warning">The latest refresh could not complete. Showing the last available briefing.</p> : null}
        {feed.lastRefresh?.status === "partial" ? <p className="news-state news-warning">Some official sources were unavailable. Available updates and cached coverage are shown below.</p> : null}
        {!feed.loading && !feed.error && !lead ? <p className="news-state">The first daily briefing will appear after the 8:00 AM refresh.</p> : null}

        {lead ? (
          <div className="ai-news-layout">
            <article className="news-lead">
              <div className="news-meta"><span>{lead.source}</span><time dateTime={lead.publishedAt}>{formatNewsDate(lead.publishedAt)}</time></div>
              <h3>{lead.title}</h3>
              <p>{lead.summary}</p>
              {lead.recommendation ? <p className="news-recommendation"><strong>MIS note:</strong> {lead.recommendation}</p> : null}
              <a href={lead.url} target="_blank" rel="noreferrer noopener">Read official update</a>
            </article>
            <div className="news-list">
              {feed.items.slice(1, 5).map((item) => (
                <article className="news-item" key={item.id || item.url}>
                  <div className="news-meta"><span>{item.source}</span><time dateTime={item.publishedAt}>{formatNewsDate(item.publishedAt)}</time></div>
                  <h3><a href={item.url} target="_blank" rel="noreferrer noopener">{item.title}</a></h3>
                  <p>{item.summary}</p>
                  {item.recommendation ? <p className="news-recommendation"><strong>MIS note:</strong> {item.recommendation}</p> : null}
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatNewsDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value));
}
