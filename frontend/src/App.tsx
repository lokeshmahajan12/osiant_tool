import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RoleGate } from "./components/RoleGate";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { HomeRouter } from "./pages/HomeRouter";
import { Investigate } from "./pages/Investigate";
import { InvestigationDetail } from "./pages/InvestigationDetail";
import { History } from "./pages/History";
import { Providers } from "./pages/Providers";
import { Settings } from "./pages/Settings";
import { AuditLog } from "./pages/AuditLog";
import { Devices } from "./pages/Devices";
import { LiveLocation } from "./pages/LiveLocation";
import { DeviceClient } from "./pages/DeviceClient";
import { Diagnostics } from "./pages/Diagnostics";
import { Privacy } from "./pages/Privacy";
import { PermissionCenter } from "./pages/PermissionCenter";
import { Camera } from "./pages/Camera";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminUserDetail } from "./pages/AdminUserDetail";
import { AdminLiveMap } from "./pages/AdminLiveMap";
import { CameraSessions } from "./pages/CameraSessions";

const STAFF = ["ADMIN", "ANALYST", "INVESTIGATOR"] as const;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/enroll/:token" element={<DeviceClient />} />
      <Route path="/device/diagnostics" element={<Diagnostics />} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomeRouter />} />
        <Route path="/dashboard" element={<HomeRouter />} />
        <Route path="/permission-center" element={<RoleGate roles={["USER"]}><PermissionCenter /></RoleGate>} />
        <Route path="/camera" element={<RoleGate roles={["USER"]}><Camera /></RoleGate>} />
        <Route path="/investigate" element={<RoleGate roles={STAFF}><Investigate /></RoleGate>} />
        <Route path="/investigation/:id" element={<RoleGate roles={STAFF}><InvestigationDetail /></RoleGate>} />
        <Route path="/history" element={<RoleGate roles={STAFF}><History /></RoleGate>} />
        <Route path="/providers" element={<RoleGate roles={["ADMIN", "INVESTIGATOR"]}><Providers /></RoleGate>} />
        <Route path="/live-location" element={<RoleGate roles={STAFF}><LiveLocation /></RoleGate>} />
        <Route path="/devices" element={<RoleGate roles={STAFF}><Devices /></RoleGate>} />
        <Route path="/audit-log" element={<RoleGate roles={["ADMIN"]}><AuditLog /></RoleGate>} />
        <Route path="/admin/users" element={<RoleGate roles={["ADMIN"]}><AdminUsers /></RoleGate>} />
        <Route path="/admin/users/:id" element={<RoleGate roles={["ADMIN"]}><AdminUserDetail /></RoleGate>} />
        <Route path="/live-map" element={<RoleGate roles={["ADMIN"]}><AdminLiveMap /></RoleGate>} />
        <Route path="/camera-sessions" element={<RoleGate roles={["ADMIN"]}><CameraSessions /></RoleGate>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/privacy" element={<Privacy />} />
      </Route>
      <Route path="*" element={<HomeRouter />} />
    </Routes>
  );
}