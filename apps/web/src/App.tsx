import { UserRole } from "@shiftwise/shared";
import "./App.css";

function App() {
  return (
    <>
      <header className="app-header">
        <h1>ShiftWise</h1>
        <p>Employer dashboard — restaurant scheduling</p>
      </header>
      <main className="app-main">
        <section className="card">
          <h2>Web app shell</h2>
          <p>
            Employer flows: onboarding, roster, schedule generation, CLEARVIEW
            export.
          </p>
          <code>Role: {UserRole.enum.EMPLOYER}</code>
        </section>
      </main>
    </>
  );
}

export default App;
