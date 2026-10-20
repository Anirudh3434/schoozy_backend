import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import registerRoutes from './routes/register.routes.js';
import examRoutes from './routes/exam.routes.js';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
const app = express();
app.use(cookieParser());



app.use(bodyParser.json());
app.use(express.json()); 




app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    credentials: true,
    origin: ["http://localhost:3000", "http://localhost:3001"],
  }),
);
// ✅ Register routes (multer inside controller will handle multipart/form-data)
app.use('/register', registerRoutes);
app.use('/exam', examRoutes);

app.get('/test', (req, res) => {
  const {name} = req.body;
  res.send(`Hello ${name}`);
});


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
