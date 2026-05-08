import { batchDeleteResources, deleteResource, renameResource } from '@/api/resources'

type ResourcePath = 'avatars' | 'voices' | 'subtitle-templates'

export function useResourceActions(path: ResourcePath) {
  async function rename(id: string, name: string) {
    const res = await renameResource(path, id, name)
    return { name: res.name, updatedAt: res.updatedAt }
  }

  async function remove(id: string) {
    const res = await deleteResource(path, id)
    return res.deletedIds
  }

  async function removeMany(ids: string[]) {
    const res = await batchDeleteResources(path, ids)
    return res.deletedIds
  }

  return { rename, remove, removeMany }
}
