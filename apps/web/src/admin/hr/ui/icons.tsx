import {
  BankOutlined,
  BarChartOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LockOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SlidersOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  WalletOutlined,
} from "@ant-design/icons";

/**
 * THE PRODUCT'S OWN ICON SET, under the names the HR module already uses.
 *
 * The module used to draw its own glyphs, traced from the Slate mockups, so
 * that two icons in the rail would match each other. They matched each other
 * and nothing else: every other module draws with `@ant-design/icons`, and a
 * person moving from Finance to Payroll saw the furniture change. These are
 * now the same icons the rest of Kuwick uses; the component names stay so
 * that no screen has to change.
 *
 * Size and colour still come from `slate.css` (the `svg` under a rail item,
 * a button or a stat label is sized there); the stroke rules written for the
 * traced glyphs are overridden for `.anticon`, because these are filled.
 */
export const IconEmployees = () => <TeamOutlined aria-hidden="true" />;
export const IconPayroll = () => <WalletOutlined aria-hidden="true" />;
export const IconClock = () => <ClockCircleOutlined aria-hidden="true" />;
export const IconCalendar = () => <CalendarOutlined aria-hidden="true" />;
export const IconClaims = () => <FileDoneOutlined aria-hidden="true" />;
export const IconReports = () => <BarChartOutlined aria-hidden="true" />;
export const IconSettings = () => <SettingOutlined aria-hidden="true" />;
export const IconCompany = () => <BankOutlined aria-hidden="true" />;
export const IconList = () => <UnorderedListOutlined aria-hidden="true" />;
export const IconSliders = () => <SlidersOutlined aria-hidden="true" />;
export const IconOpeningBalances = () => <InboxOutlined aria-hidden="true" />;
export const IconSearch = () => <SearchOutlined aria-hidden="true" />;
export const IconLock = () => <LockOutlined aria-hidden="true" />;
export const IconInfo = () => <InfoCircleOutlined aria-hidden="true" />;
export const IconEdit = () => <EditOutlined aria-hidden="true" />;
export const IconMore = () => <EllipsisOutlined aria-hidden="true" />;
export const IconDownload = () => <DownloadOutlined aria-hidden="true" />;
export const IconHistory = () => <HistoryOutlined aria-hidden="true" />;
export const IconDoc = () => <FileTextOutlined aria-hidden="true" />;
export const IconPlus = () => <PlusOutlined aria-hidden="true" />;
export const IconClose = () => <CloseOutlined aria-hidden="true" />;
