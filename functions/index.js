export async function onRequest({ request }) {
  const url = new URL(request.url);

  return Response.redirect(
    new URL("/editorial/", url),
    302
  );
}
