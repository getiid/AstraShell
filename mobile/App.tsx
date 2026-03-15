import { StatusBar } from 'expo-status-bar'
import React, { useMemo, useState } from 'react'
import { SafeAreaView, View, Text, StyleSheet, Pressable, ScrollView, TextInput } from 'react-native'

type TabKey = 'hosts' | 'sftp' | 'snippets' | 'settings'
type HostItem = { id: string; name: string; host: string; port: number; user: string; category: string; auth: 'password' | 'key' }

const categories = ['全部', '生产', '测试', '内网']
const hostsSeed: HostItem[] = [
  { id: 'h1', name: '生产集群-A', host: 'prod-a.example.internal', port: 22, user: 'ops', category: '生产', auth: 'password' },
  { id: 'h2', name: '生产集群-B', host: 'prod-b.example.internal', port: 22, user: 'ops', category: '生产', auth: 'key' },
  { id: 'h3', name: '办公跳板机', host: 'bastion.office.internal', port: 22, user: 'admin', category: '内网', auth: 'password' },
  { id: 'h4', name: '预发环境-Web', host: 'staging-web.example.internal', port: 22, user: 'deploy', category: '测试', auth: 'key' },
]

const snippetsSeed = [
  { id: 's1', name: '部署 Docker', category: '部署', cmd: 'curl -fsSL https://get.docker.com | sh' },
  { id: 's2', name: '查看系统信息', category: '巡检', cmd: 'uname -a && free -h && df -h' },
  { id: 's3', name: '重启服务', category: '运维', cmd: 'sudo systemctl restart nginx' },
]

function maskHost(host: string): string {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.*.*`

  const parts = host.split('.')
  if (parts.length > 1) {
    const head = parts[0] || ''
    const maskedHead = head.length <= 2 ? `${head.slice(0, 1)}*` : `${head.slice(0, 2)}***`
    return `${maskedHead}.${parts.slice(1).join('.')}`
  }

  if (host.length <= 2) return `${host.slice(0, 1)}*`
  return `${host.slice(0, 2)}***`
}

function HostsScreen() {
  const [category, setCategory] = useState('全部')
  const [selectedId, setSelectedId] = useState(hostsSeed[0]?.id || '')
  const [keyword, setKeyword] = useState('')
  const filtered = useMemo(() => {
    return hostsSeed.filter((h) => {
      const inCategory = category === '全部' || h.category === category
      if (!inCategory) return false
      if (!keyword.trim()) return true
      const q = keyword.trim().toLowerCase()
      return [h.name, h.host, maskHost(h.host), h.user, h.category].some((v) => v.toLowerCase().includes(q))
    })
  }, [category, keyword])

  const active = filtered.find((h) => h.id === selectedId) || filtered[0]

  return (
    <View style={styles.screenCard}>
      <Text style={styles.screenTitle}>SSH 主机</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {categories.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            style={[styles.chip, c === category ? styles.chipActive : null]}
          >
            <Text style={[styles.chipText, c === category ? styles.chipTextActive : null]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <TextInput
        value={keyword}
        onChangeText={setKeyword}
        placeholder="搜索主机/别名/用户名"
        placeholderTextColor="#94A3B8"
        style={styles.input}
      />

      <ScrollView style={styles.hostList}>
        {filtered.map((h) => (
          <Pressable
            key={h.id}
            onPress={() => setSelectedId(h.id)}
            style={[styles.hostCard, h.id === active?.id ? styles.hostCardActive : null]}
          >
            <Text style={styles.hostTitle}>{h.name}</Text>
            <Text style={styles.hostMeta}>{`${maskHost(h.host)}:${h.port}`}</Text>
            <Text style={styles.hostMeta}>{`${h.user} · ${h.category} · ${h.auth}`}</Text>
          </Pressable>
        ))}
        {filtered.length === 0 ? <Text style={styles.emptyText}>无匹配主机</Text> : null}
      </ScrollView>

      <View style={styles.editorCard}>
        <Text style={styles.editorTitle}>主机编辑（移动端首版）</Text>
        {active ? (
          <>
            <Text style={styles.editorLine}>名称：{active.name}</Text>
            <Text style={styles.editorLine}>地址：{`${maskHost(active.host)}:${active.port}`}</Text>
            <Text style={styles.editorLine}>认证：{active.auth === 'key' ? '密钥认证' : '密码认证'}</Text>
            <View style={styles.actionRow}>
              <Pressable style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>连接终端</Text>
              </Pressable>
              <Pressable style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>编辑参数</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={styles.emptyText}>请选择主机</Text>
        )}
      </View>
    </View>
  )
}

function SftpScreen() {
  const localRows = ['C:/', 'D:/', 'E:/', 'F:/']
  const remoteRows = ['/root', '/var/www', '/etc/nginx', '/home']
  return (
    <View style={styles.screenCard}>
      <Text style={styles.screenTitle}>SFTP 双栏</Text>
      <View style={styles.sftpPanelWrap}>
        <View style={styles.sftpPane}>
          <Text style={styles.sftpPaneTitle}>左侧 · 本地</Text>
          <ScrollView>
            {localRows.map((row) => (
              <View key={row} style={styles.fileRow}>
                <Text style={styles.fileName}>{row}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
        <View style={styles.sftpPane}>
          <Text style={styles.sftpPaneTitle}>右侧 · 远程</Text>
          <ScrollView>
            {remoteRows.map((row) => (
              <View key={row} style={styles.fileRow}>
                <Text style={styles.fileName}>{row}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
      <Text style={styles.caption}>首版先完成浏览与连接绑定，下一步接入真实上传/下载流程。</Text>
    </View>
  )
}

function SnippetsScreen() {
  return (
    <View style={styles.screenCard}>
      <Text style={styles.screenTitle}>代码片段</Text>
      <ScrollView>
        {snippetsSeed.map((s) => (
          <View key={s.id} style={styles.snippetCard}>
            <Text style={styles.snippetTitle}>{s.name}</Text>
            <Text style={styles.snippetMeta}>{s.category}</Text>
            <Text numberOfLines={2} style={styles.snippetCmd}>{s.cmd}</Text>
            <View style={styles.actionRow}>
              <Pressable style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>执行</Text>
              </Pressable>
              <Pressable style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>发送到终端</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function SettingsScreen() {
  return (
    <View style={styles.screenCard}>
      <Text style={styles.screenTitle}>设置</Text>
      <View style={styles.settingItem}>
        <Text style={styles.settingTitle}>数据库路径</Text>
        <Text style={styles.settingDesc}>首次启动创建，后续可切换并重启生效。</Text>
      </View>
      <View style={styles.settingItem}>
        <Text style={styles.settingTitle}>密钥仓库解锁</Text>
        <Text style={styles.settingDesc}>每次进入先解锁，保障本地密钥安全。</Text>
      </View>
      <View style={styles.settingItem}>
        <Text style={styles.settingTitle}>检查更新</Text>
        <Text style={styles.settingDesc}>基于 GitHub Release，一键检查并下载新版本。</Text>
      </View>
    </View>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('hosts')

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>AstraShell Mobile</Text>
        <Text style={styles.sub}>Android / iOS 统一客户端（Expo）</Text>
      </View>

      <View style={styles.tabBar}>
        {[
          { key: 'hosts', label: '主机' },
          { key: 'sftp', label: 'SFTP' },
          { key: 'snippets', label: '片段' },
          { key: 'settings', label: '设置' },
        ].map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setTab(item.key as TabKey)}
            style={[styles.tabBtn, tab === item.key ? styles.tabBtnActive : null]}
          >
            <Text style={[styles.tabText, tab === item.key ? styles.tabTextActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.body}>
        {tab === 'hosts' ? <HostsScreen /> : null}
        {tab === 'sftp' ? <SftpScreen /> : null}
        {tab === 'snippets' ? <SnippetsScreen /> : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#E9EEF4' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  brand: { fontSize: 24, fontWeight: '800', color: '#0F172A' },
  sub: { marginTop: 2, color: '#475569', fontSize: 12 },
  tabBar: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 4,
    borderRadius: 14,
    backgroundColor: '#DCE5EF',
    flexDirection: 'row',
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: '#FFFFFF' },
  tabText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#0F172A', fontWeight: '700' },
  body: { flex: 1, paddingHorizontal: 12, paddingBottom: 12 },
  screenCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CDD8E3',
    backgroundColor: '#F8FAFC',
    padding: 12,
  },
  screenTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 10 },
  chipRow: { marginBottom: 8, maxHeight: 38 },
  chip: {
    marginRight: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipActive: { backgroundColor: '#2563EB' },
  chipText: { color: '#334155', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 10,
    color: '#0F172A',
  },
  hostList: { flex: 1, marginBottom: 10 },
  hostCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E0EA',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  hostCardActive: { borderColor: '#3B82F6', shadowColor: '#2563EB', shadowOpacity: 0.15, shadowRadius: 8 },
  hostTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  hostMeta: { fontSize: 12, color: '#64748B', marginTop: 2 },
  editorCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4DEEA',
    backgroundColor: '#EEF4FA',
    padding: 10,
  },
  editorTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  editorLine: { fontSize: 12, color: '#334155', marginBottom: 4 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  primaryBtn: { flex: 1, backgroundColor: '#2563EB', borderRadius: 10, alignItems: 'center', paddingVertical: 8 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  ghostBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#BFD0E2',
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 8,
  },
  ghostBtnText: { color: '#1E3A8A', fontWeight: '700', fontSize: 12 },
  emptyText: { color: '#64748B', fontSize: 12, paddingVertical: 6 },
  sftpPanelWrap: { flex: 1, flexDirection: 'row', gap: 10 },
  sftpPane: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    backgroundColor: '#FFFFFF',
    padding: 8,
  },
  sftpPaneTitle: { fontSize: 12, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  fileRow: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
    backgroundColor: '#F8FAFC',
  },
  fileName: { fontSize: 12, color: '#334155' },
  caption: { marginTop: 8, color: '#64748B', fontSize: 12 },
  snippetCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8E1EB',
    backgroundColor: '#FFFFFF',
    padding: 10,
    marginBottom: 8,
  },
  snippetTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  snippetMeta: { marginTop: 2, fontSize: 11, color: '#475569' },
  snippetCmd: {
    marginTop: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: '#334155',
    fontSize: 11,
  },
  settingItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8E1EB',
    backgroundColor: '#FFFFFF',
    padding: 10,
    marginBottom: 8,
  },
  settingTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  settingDesc: { marginTop: 4, fontSize: 12, color: '#64748B', lineHeight: 18 },
})
