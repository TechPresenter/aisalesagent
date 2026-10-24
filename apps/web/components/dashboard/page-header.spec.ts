import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HandwritingText } from "@/components/ui/handwriting-text";
import { PageHeader } from "./page-header";

/**
 * The dashboard header, rendered to markup. Its tagline used to open with the demo
 * workspace's name and end on "every clinic.", and drew itself with a script and a font
 * fetched from two third-party CDNs.
 */
describe("PageHeader", () => {
  const html = renderToStaticMarkup(createElement(PageHeader));

  it("opens the tagline on a word that fits any workspace", () => {
    expect(html).toContain("Find. Call. Convert. Grow");
    expect(html).toContain("your pipeline.");
    expect(html).not.toMatch(/Northwind|clinic/i);
  });

  it("draws the tagline with markup and CSS alone", () => {
    // The tagline is the header's one paragraph; the button's icon is an SVG of its own.
    const tagline = /<p[\s>].*?<\/p>/.exec(html)?.[0] ?? "";
    expect(tagline).toContain("your pipeline.");
    expect(tagline).not.toMatch(/<script|<svg|<img|https?:\/\//);
    expect(html).not.toMatch(/<script|cdn\.21st\.dev|cdn\.jsdelivr\.net/);
  });
});

describe("HandwritingText", () => {
  it("is read once by assistive technology, while the two drawn copies are hidden", () => {
    const markup = renderToStaticMarkup(createElement(HandwritingText, { text: "Converted" }));
    expect(markup).toContain('<span class="sr-only">Converted</span>');
    expect(markup.match(/Converted/g)).toHaveLength(3);
    expect(markup).toMatch(/<span aria-hidden="true" class="inline-grid">/);
  });

  it("leaves only the outline when fill is off", () => {
    const markup = renderToStaticMarkup(
      createElement(HandwritingText, { text: "Interested", fill: false }),
    );
    expect(markup.match(/Interested/g)).toHaveLength(2);
  });
});
