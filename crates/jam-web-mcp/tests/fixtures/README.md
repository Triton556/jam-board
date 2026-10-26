# Web provider fixtures

These small, sanitized provider-format snapshots use fictional `example.*`
URLs and contain no credentials. They are checked in so parsing tests never
need network access. They are not captures from an authenticated live query.

Field shapes were checked against the official references:

- [Brave image search](https://api-dashboard.search.brave.com/api-reference/images/image_search)
- [Tavily search](https://docs.tavily.com/documentation/api-reference/endpoint/search)

The Tavily images fixture also covers the older array-of-URL-strings form.
Live provider behavior and actual API credentials require separate verification.
