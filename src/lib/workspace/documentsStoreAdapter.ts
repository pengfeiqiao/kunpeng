import { useWorkshopStore } from '../../stores/workshopStore';
import { useSkillStore } from '../../stores/skillStore';
import { createLocalWorkspaceDocumentPort } from './documentsLocal';

/** Mount once per shell. Creating the port itself neither scans skills nor reads project files. */
export function createWorkshopDocumentsPort() {
  return createLocalWorkspaceDocumentPort({
    getContext: () => {
      const { project, data } = useWorkshopStore.getState();
      if (!project || !data || data.projectId !== project.id) return null;
      return { project, spec: data.projectSpec, skills: useSkillStore.getState().skills };
    },
    reloadSkills: () => useSkillStore.getState().loadAllSkills(),
    commitSpec: async (projectId, expectedRevision, patch) => {
      const state = useWorkshopStore.getState();
      if (state.project?.id !== projectId || state.data?.projectId !== projectId) throw new Error('项目已经切换，草稿已保留');
      if (!state.data.projectSpec || state.data.projectSpec.revision !== expectedRevision) throw new Error('规格版本已改变，未覆盖');
      // Same command as the existing structured SpecEditor. No await between the guard, update and captured save.
      state.updateProjectSpec(patch);
      const updated = useWorkshopStore.getState();
      const receipt = updated.data!.projectSpec!;
      await updated.commitNow({ requireSuccess: true });
      return receipt;
    },
  });
}
