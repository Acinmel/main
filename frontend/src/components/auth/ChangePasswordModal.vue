<script setup lang="ts">
import { NButton, NForm, NFormItem, NInput, NModal, useMessage } from 'naive-ui'
import { reactive, ref, watch } from 'vue'
import { changePasswordAuth } from '@/api/auth'
import { describeHttpOrNetworkError } from '@/utils/httpErrorMessage'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
}>()

const message = useMessage()
const loading = ref(false)
const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

watch(
  () => props.show,
  (visible) => {
    if (!visible) return
    form.currentPassword = ''
    form.newPassword = ''
    form.confirmPassword = ''
  },
)

function closeModal() {
  emit('update:show', false)
}

async function submitChangePassword() {
  if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
    message.warning('请填写完整密码信息')
    return
  }
  if (form.newPassword.length < 8) {
    message.warning('新密码至少 8 位')
    return
  }
  if (form.newPassword !== form.confirmPassword) {
    message.warning('两次输入的新密码不一致')
    return
  }
  if (form.currentPassword === form.newPassword) {
    message.warning('新密码不能与当前密码相同')
    return
  }

  loading.value = true
  try {
    await changePasswordAuth({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    })
    message.success('密码已修改，请使用新密码登录')
    closeModal()
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="change-password-modal"
    title="修改密码"
    :bordered="false"
    :mask-closable="false"
    @update:show="emit('update:show', $event)"
  >
    <n-form label-placement="top">
      <n-form-item label="当前密码">
        <n-input
          v-model:value="form.currentPassword"
          type="password"
          show-password-on="click"
          placeholder="请输入当前密码"
        />
      </n-form-item>
      <n-form-item label="新密码">
        <n-input
          v-model:value="form.newPassword"
          type="password"
          show-password-on="click"
          placeholder="至少 8 位"
        />
      </n-form-item>
      <n-form-item label="确认新密码">
        <n-input
          v-model:value="form.confirmPassword"
          type="password"
          show-password-on="click"
          placeholder="再次输入新密码"
        />
      </n-form-item>
      <div class="change-password-modal__actions">
        <n-button @click="closeModal">取消</n-button>
        <n-button type="primary" :loading="loading" @click="submitChangePassword">
          确认修改
        </n-button>
      </div>
    </n-form>
  </n-modal>
</template>

<style scoped>
.change-password-modal {
  width: min(92vw, 460px);
}

.change-password-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
</style>
