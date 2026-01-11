export default function Dashboard() {
  const stats = [
    { title: "Total Products", value: 150 },
    { title: "Low Stock Items", value: 12 },
    { title: "Inventory Value", value: "₦250,000" },
  ];

  return (    
    <div style={{ padding: 20 }}>
      <h1>Dashboard</h1>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 20,
        marginTop: 20
      }}>
        {stats.map((stat, i) => (
          <div className="card" key={i} style={{
            background: "#f3f4f6",
            padding: 20,
            borderRadius: 8,
            boxShadow: "0 2px 5px rgba(0,0,0,0.1)"
          }}>
            <h3>{stat.title}</h3>
            <p style={{ fontSize: 24, fontWeight: "bold" }}>{stat.value}</p>
            <button className="btn">Add Product</button>

          </div>
        ))}
      </div>
    </div>
  );
}
