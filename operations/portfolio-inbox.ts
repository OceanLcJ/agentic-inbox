interface ArchiveMessage {
  raw: ReadableStream;
  rawSize: number;
  to: string;
  from: string;
  setReject(reason: string): void;
}

interface ArchiveEnvironment {
  PORTFOLIO_INBOX?: { fetch(request: Request): Promise<Response> };
}

export async function processWithInboxArchive<T extends ArchiveMessage>(
  message: T,
  env: ArchiveEnvironment,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  processOriginal: (message: T) => unknown | Promise<unknown>
) {
  const binding = env.PORTFOLIO_INBOX;
  if (!binding) return processOriginal(message);
  const [originalStream, archiveStream] = message.raw.tee();
  let rejected = false;
  const originalMessage = new Proxy(message, {
    get(target, property) {
      if (property === 'raw') return originalStream;
      if (property === 'setReject') {
        return (reason: string) => {
          rejected = true;
          target.setReject(reason);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const cancel = (stream: ReadableStream) => {
    if (!stream.locked) void stream.cancel().catch(() => {});
  };
  let result: unknown;
  try {
    result = await processOriginal(originalMessage);
  } catch (error) {
    cancel(originalStream);
    cancel(archiveStream);
    throw error;
  }
  if (rejected) {
    cancel(originalStream);
    cancel(archiveStream);
    return result;
  }
  // Preserve the original processing outcome. Archive delivery is an additional
  // copy and must never reject a message that the business handler accepted.
  const requestOptions: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      'x-envelope-to': message.to,
      'x-envelope-from': message.from,
      'x-raw-size': String(message.rawSize),
    },
    body: archiveStream,
    duplex: 'half',
  };
  const archival = Promise.resolve().then(() => binding.fetch(
    new Request('https://portfolio-inbox/archive', requestOptions)
  )).then(async (response) => {
    if (!response.ok) throw new Error(`Inbox archive returned ${response.status}`);
    await response.body?.cancel();
  }).catch((error) => {
    console.error('[portfolio-inbox] Archive failed', String(error));
  }).finally(() => {
    cancel(originalStream);
    cancel(archiveStream);
  });
  ctx.waitUntil(archival);
  return result;
}
