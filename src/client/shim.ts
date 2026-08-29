// Alpha.1 type shim: the client Runtime package was removed upstream.
export type ClientContext = import('@deepseek-ai/cordis').Context & Record<string, any>
export type ObservableSnapshot<T> = import('@deepseek-ai/dsh-client-store').ObservableSnapshot<T>
