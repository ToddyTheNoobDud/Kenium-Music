export type TrackRequester = {
  id?: string
  username?: string
}

// Live tracks carry a user object; AquaLink restores an "id:username" tag.
export const getTrackRequester = (requester: unknown): TrackRequester => {
  if (typeof requester !== 'string') {
    return (requester as TrackRequester | null | undefined) ?? {}
  }

  const separator = requester.indexOf(':')
  return separator === -1
    ? { id: requester }
    : {
        id: requester.slice(0, separator),
        username: requester.slice(separator + 1)
      }
}
