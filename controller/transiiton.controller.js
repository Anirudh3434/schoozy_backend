const InsertTransection = async (req, res) => {
    const { transitionId, transitionName, transitionType, transitionDescription } = req.body;
    try {
        
          const query = `
    INSERT INTO TRANSECTION_MASTER (payment_id, user_id, amount, payment_method, status)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(query, [transitionId, transitionName, transitionType, transitionDescription], (err, result) => {
    if (err) {
      console.error('❌ Insert error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(201).json({ message: 'Transaction inserted', id: result.insertId });
  });

    } catch (error) {
        console.error('❌ Insert error:', error);
        return res.status(500).json({ error: 'Database error' });
    }
}


export { InsertTransection }