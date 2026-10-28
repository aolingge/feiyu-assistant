// Synthetic read-only platform. Unknown endpoints fail without real networking.
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
globalThis.fetch = async input => {
  const u = new URL(input)
  if (u.pathname === '/x/web-interface/nav') return json({ code: 0, data: { wbi_img: { img_url: 'https://invalid/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://invalid/4932caff0ff746eab6f01bf08b70ac45.png' } } })
  if (u.pathname === '/x/web-interface/wbi/view') return json({ code: 0, data: { aid: 123, cid: 42, title: 'Synthetic video', duration: 10, owner: { name: 'Fixture' }, stat: {}, pages: [{ cid: 42 }], pubdate: 1, pic: 'https://invalid/cover.jpg' } })
  if (u.pathname === '/x/player/wbi/v2' || u.pathname === '/x/v2/subtitle/web/view') return json({ code: 0, data: { subtitle: { subtitles: process.env.TEST_NO_SUBTITLE ? [] : [{ lan: 'ai-zh', subtitle_url: 'https://invalid/ai.json' }, { lan: 'zh-CN', id: 10, subtitle_url: 'https://invalid/manual.json?auth_key=synthetic-only' }] } } })
  if (u.pathname === '/manual.json') return json({ body: [{ from: 1, to: 4, content: 'Synthetic manual Chinese' }] })
  if (u.pathname === '/cover.jpg') return new Response(new Uint8Array([0, 1, 2]))
  if (u.pathname === '/42.xml') return new Response('<i></i>')
  if (u.pathname === '/x/tag/archive/tags') return json({ code: 0, data: [] })
  if (u.pathname === '/x/v2/reply') return json({ code: 0, data: { replies: [] } })
  throw new Error('UNEXPECTED_SYNTHETIC_VIDEO_ENDPOINT')
}
